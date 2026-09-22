"""Cost engine — deterministic voyage-cost and landed-cost calculator.

Every modelled coefficient lives in the CONFIG dict below so that:
  1. The UI can expose / explain each assumption.
  2. Sensitivity analysis can override individual keys.
  3. Calibration against broker quotes is a simple dict update.

Usage:
    breakdown = compute_cost(
        cargo_tonnes=50000,
        distance_nm=4200,
        vessel=vessel_dict,
        index_value=1400,
        crude_usd_bbl=78.5,
        usd_inr=83.2,
        commodity_usd_per_unit=110.0,
        dest_port_id="paradip",
    )
"""

from __future__ import annotations

from typing import Any

# =========================================================================
# CONFIG — all modelled coefficients in one place
# =========================================================================
CONFIG: dict[str, Any] = {
    # ── Daily-hire calibration ──────────────────────────────────────────
    # Maps Baltic sub-index value → approximate TC daily hire (USD/day).
    # Formula: daily_hire = index_value * slope + intercept
    # These are rough linear regressions fitted to 2022-2025 broker data.
    # Re-calibrate periodically against actual fixtures.
    "hire_coefficients": {
        "BCI":  {"slope": 8.5,  "intercept": 1500, "comment": "Capesize — high volatility; slope captures wide swings"},
        "BPI":  {"slope": 9.0,  "intercept": 1000, "comment": "Panamax/Kamsarmax — core Indian coal vessel"},
        "BSI":  {"slope": 8.0,  "intercept": 800,  "comment": "Supramax — geared; premium for self-loading flexibility"},
        "BHSI": {"slope": 7.5,  "intercept": 500,  "comment": "Handysize — smallest class; lower absolute hire but higher $/t on small parcels"},
    },

    # ── Bunker proxy ────────────────────────────────────────────────────
    # VLSFO price ≈ crude_oil_price × VLSFO_FACTOR
    # Empirical ratio from 2022-2025 Singapore VLSFO vs Brent crude.
    # VLSFO typically trades at ~$500-650/mt when crude is ~$75-85/bbl.
    "VLSFO_FACTOR": 6.5,  # VLSFO_usd_mt ≈ crude_usd_bbl × 6.5

    # ── Port days ───────────────────────────────────────────────────────
    # Default loading + discharge time (days). Override per port below.
    "default_load_days": 2,    # days at load port
    "default_disch_days": 2,   # days at discharge port

    # ── Port-specific discharge days ────────────────────────────────────
    # Based on avg_turnaround_hours from ports.json, but can be overridden.
    "disch_days_override": {
        "haldia": 5,       # river-port congestion
        "sandheads": 7,    # lighterage operations are slow
    },

    # ── Port charges (USD, lump-sum estimate per call) ──────────────────
    # Includes pilotage, towage, berth hire, wharfage, agency fees.
    # These are order-of-magnitude estimates; real charges depend on GT,
    # LOA, cargo type, and port tariff revisions.
    "port_charges_usd": {
        "paradip": 45000,
        "visakhapatnam": 50000,
        "gangavaram": 55000,
        "gopalpur": 35000,
        "dhamra": 48000,
        "haldia": 40000,
        "sandheads": 30000,   # anchorage — lower formal charges but add lighterage
        "_default": 45000,    # fallback for unknown ports
    },

    # ── Lighterage surcharge ────────────────────────────────────────────
    # Additional USD/tonne for ports requiring lighterage (e.g., Sandheads)
    "lighterage_surcharge_usd_per_t": {
        "sandheads": 3.5,
    },

    # ── Miscellaneous ───────────────────────────────────────────────────
    "insurance_pct": 0.0015,   # 0.15% of cargo value — approximate H&M + P&I
    "brokerage_pct": 0.0125,   # 1.25% address commission (industry standard)
}


# =========================================================================
# Core computation
# =========================================================================

def compute_cost(
    cargo_tonnes: float,
    distance_nm: float,
    vessel: dict[str, Any],
    index_value: float,
    crude_usd_bbl: float,
    usd_inr: float,
    commodity_usd_per_unit: float,
    dest_port_id: str,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute a full voyage-cost and landed-cost breakdown.

    Parameters
    ----------
    cargo_tonnes : float
        Cargo size in metric tonnes.
    distance_nm : float
        One-way sea distance in nautical miles.
    vessel : dict
        Vessel-class record (from vessel_classes.json).
    index_value : float
        Current Baltic sub-index value for this vessel class
        (e.g., BPI value for a Panamax).
    crude_usd_bbl : float
        Crude oil price in USD/barrel (used to proxy bunker cost).
    usd_inr : float
        Current USD/INR exchange rate.
    commodity_usd_per_unit : float
        FOB price of the commodity in USD per tonne (or per dmt for iron ore).
    dest_port_id : str
        ID of the destination (discharge) port.
    config : dict, optional
        Override the module-level CONFIG for testing/sensitivity.

    Returns
    -------
    dict
        Full breakdown with every line item for UI transparency.
    """
    cfg = config or CONFIG

    # ── 1. Voyage duration ──────────────────────────────────────────────
    service_speed = vessel["service_speed_kn"]
    sea_days_laden = distance_nm / (service_speed * 24)

    load_days = cfg["default_load_days"]
    disch_days = cfg["disch_days_override"].get(
        dest_port_id, cfg["default_disch_days"]
    )
    port_days = load_days + disch_days
    total_voyage_days = sea_days_laden + port_days

    # ── 2. Daily hire ───────────────────────────────────────────────────
    baltic_index = vessel["baltic_index"]
    coeff = cfg["hire_coefficients"][baltic_index]
    daily_hire_usd = index_value * coeff["slope"] + coeff["intercept"]

    # ── 3. Bunker cost ──────────────────────────────────────────────────
    bunker_price_usd_mt = crude_usd_bbl * cfg["VLSFO_FACTOR"]
    consumption_laden = vessel["consumption_laden_mt_per_day"]
    # Laden sea days only (port days use much less fuel — ignore for now)
    bunker_cost_usd = consumption_laden * sea_days_laden * bunker_price_usd_mt

    # ── 4. Port charges ─────────────────────────────────────────────────
    port_charges_usd = cfg["port_charges_usd"].get(
        dest_port_id, cfg["port_charges_usd"]["_default"]
    )

    # ── 5. Lighterage surcharge ─────────────────────────────────────────
    lighterage_per_t = cfg["lighterage_surcharge_usd_per_t"].get(
        dest_port_id, 0.0
    )
    lighterage_usd = lighterage_per_t * cargo_tonnes

    # ── 6. Total freight ────────────────────────────────────────────────
    hire_cost_usd = daily_hire_usd * total_voyage_days
    freight_usd = hire_cost_usd + bunker_cost_usd + port_charges_usd + lighterage_usd

    # ── 7. Brokerage & insurance ────────────────────────────────────────
    brokerage_usd = freight_usd * cfg["brokerage_pct"]
    cargo_value_usd = commodity_usd_per_unit * cargo_tonnes
    insurance_usd = cargo_value_usd * cfg["insurance_pct"]

    total_cost_usd = freight_usd + brokerage_usd + insurance_usd

    # ── 8. Per-tonne metrics ────────────────────────────────────────────
    freight_per_tonne_usd = freight_usd / cargo_tonnes
    total_cost_per_tonne_usd = total_cost_usd / cargo_tonnes
    freight_per_tonne_inr = freight_per_tonne_usd * usd_inr

    # ── 9. Landed cost ──────────────────────────────────────────────────
    landed_cost_per_tonne_usd = commodity_usd_per_unit + total_cost_per_tonne_usd
    landed_cost_per_tonne_inr = landed_cost_per_tonne_usd * usd_inr

    return {
        "summary": {
            "freight_usd": round(freight_usd, 2),
            "freight_per_tonne_usd": round(freight_per_tonne_usd, 2),
            "freight_per_tonne_inr": round(freight_per_tonne_inr, 2),
            "landed_cost_per_tonne_usd": round(landed_cost_per_tonne_usd, 2),
            "landed_cost_per_tonne_inr": round(landed_cost_per_tonne_inr, 2),
        },
        "voyage": {
            "distance_nm": round(distance_nm, 1),
            "service_speed_kn": service_speed,
            "sea_days_laden": round(sea_days_laden, 2),
            "load_days": load_days,
            "disch_days": disch_days,
            "total_voyage_days": round(total_voyage_days, 2),
        },
        "hire": {
            "baltic_index": baltic_index,
            "index_value": index_value,
            "slope": coeff["slope"],
            "intercept": coeff["intercept"],
            "daily_hire_usd": round(daily_hire_usd, 2),
            "hire_cost_usd": round(hire_cost_usd, 2),
        },
        "bunker": {
            "crude_usd_bbl": crude_usd_bbl,
            "vlsfo_factor": cfg["VLSFO_FACTOR"],
            "bunker_price_usd_mt": round(bunker_price_usd_mt, 2),
            "consumption_laden_mt_per_day": consumption_laden,
            "sea_days_laden": round(sea_days_laden, 2),
            "bunker_cost_usd": round(bunker_cost_usd, 2),
        },
        "port": {
            "port_charges_usd": port_charges_usd,
            "lighterage_usd": round(lighterage_usd, 2),
        },
        "fees": {
            "brokerage_pct": cfg["brokerage_pct"],
            "brokerage_usd": round(brokerage_usd, 2),
            "insurance_pct": cfg["insurance_pct"],
            "insurance_usd": round(insurance_usd, 2),
        },
        "fx": {
            "usd_inr": usd_inr,
        },
        "commodity": {
            "fob_usd_per_tonne": commodity_usd_per_unit,
            "cargo_tonnes": cargo_tonnes,
        },
    }
