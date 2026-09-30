"""Multi-voyage contract planner (SIH26006 core objective).

Bridges the single-voyage /decision pipeline to short/medium-term contracts
by fanning the same forecast / cost / feasibility / risk engines out over a
fleet of evenly-spaced voyages, then aggregating the per-voyage results and
comparing them to a point-in-time spot benchmark.

Deliberately additive: this module never imports decision.py and never
mutates cost / risk / feasibility state. Every voyage in the schedule is
priced with the same forecast_svc, compute_cost, and feasible() calls that
/decision uses today.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta
from typing import Any

from app.db import (
    get_conn,
    get_load_port_by_id,
    get_port_by_id,
    get_vessel_classes,
    query_latest_pinksheet,
    query_latest_usdinr,
)
from app.engine.cost import compute_cost
from app.engine.distance import get_distance
from app.engine.feasibility import feasible
from app.engine.risk import compute_composite_risk
from app.model.service import get_forecast_service

log = logging.getLogger(__name__)


# ── Commodity resolution (mirrors /decision, kept local to avoid coupling) ──

def _resolve_commodity(commodity: str, pinksheet: dict[str, Any]) -> tuple[float, str]:
    """Map a commodity slug to (USD/tonne FOB, display name)."""
    clean = commodity.lower().strip()
    if clean in ("iron_ore", "ironore", "ore"):
        return float(pinksheet.get("iron_ore_usd_dmt", 105.0)), "Iron Ore (62% Fe CFR)"
    if clean in ("coking_coal", "met_coal", "coal_au"):
        return float(pinksheet.get("coal_au_usd_mt", 185.0)), "Premium Coking Coal (Australia FOB)"
    if clean in ("thermal_coal", "coal_sa", "coal"):
        return float(pinksheet.get("coal_sa_usd_mt", 138.0)), "Thermal Coal (South Africa FOB)"
    return float(pinksheet.get("iron_ore_usd_dmt", 105.0)), commodity.title()


# ── Vessel class selection ──────────────────────────────────────────────────

def _pick_best_class(
    parcel_size: float,
    dest_port: dict[str, Any],
    load_port: dict[str, Any],
    all_classes: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Return the smallest feasible class whose DWT band covers the parcel.

    Filtered so the vessel physically fits BOTH ports (via feasible()). We
    prefer a tighter fit (smaller max-DWT) so the parcel utilises capacity
    without over-chartering. Returns None if no class is feasible.
    """
    feasible_classes: list[tuple[dict[str, Any], int]] = []
    for v in all_classes:
        f = feasible(parcel_size, dest_port, v, load_port=load_port)
        if not f["feasible"]:
            continue
        # Prefer classes whose DWT band includes the parcel size (utilisation
        # in [min, max]); otherwise fall back to whichever is feasible.
        in_band = v["dwt_min"] <= parcel_size <= v["dwt_max"]
        feasible_classes.append((v, 0 if in_band else 1))
    if not feasible_classes:
        return None
    feasible_classes.sort(key=lambda x: (x[1], x[0]["dwt_max"]))
    return feasible_classes[0][0]


# ── Public entry point ──────────────────────────────────────────────────────

def plan_contract(
    annual_tonnes: float,
    parcel_size: float,
    commodity: str,
    load_port_id: str,
    dest_port_id: str,
    contract_months: int,
    start_date: str,
) -> dict[str, Any]:
    """Plan a multi-voyage contract and compare it to today's spot price.

    Raises
    ------
    ValueError
        On bad input (non-positive tonnage, out-of-range contract months,
        parcel bigger than the whole contract, unknown port ids). The
        router maps these to HTTP 400.
    """
    # ── 1. Input validation (surface friendly errors, not tracebacks) ─────
    if annual_tonnes <= 0:
        raise ValueError("annual_tonnes must be positive")
    if parcel_size <= 0:
        raise ValueError("parcel_size must be positive")
    if not (1 <= contract_months <= 12):
        raise ValueError("contract_months must be between 1 and 12")

    total_tonnes = annual_tonnes * (contract_months / 12.0)
    if parcel_size > total_tonnes:
        raise ValueError(
            f"parcel_size ({parcel_size:,.0f} t) exceeds contract volume "
            f"({total_tonnes:,.0f} t = annual {annual_tonnes:,.0f} t × "
            f"{contract_months}/12 months) — nothing to schedule"
        )

    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"start_date must be YYYY-MM-DD (got {start_date!r})") from exc

    load_port = get_load_port_by_id(load_port_id)
    if not load_port:
        raise ValueError(f"Load port '{load_port_id}' not found.")
    dest_port = get_port_by_id(dest_port_id)
    if not dest_port:
        raise ValueError(f"Destination port '{dest_port_id}' not found.")

    # ── 2. Contract geometry ──────────────────────────────────────────────
    voyage_count = max(1, math.ceil(total_tonnes / parcel_size))
    contract_days = int(round(contract_months * 30.4375))  # avg month length
    end_dt = start_dt + timedelta(days=contract_days)
    spacing_days = max(1, contract_days // voyage_count)

    # ── 3. Shared market context (fetched once) ───────────────────────────
    pinksheet = query_latest_pinksheet()
    fx = query_latest_usdinr()
    crude_usd_bbl = float(pinksheet.get("crude_avg_usd_bbl", 75.0))
    usd_inr = float(fx.get("usd_inr", 83.2))
    comm_usd, comm_display = _resolve_commodity(commodity, pinksheet)

    all_classes = get_vessel_classes()
    vessel = _pick_best_class(parcel_size, dest_port, load_port, all_classes)
    if vessel is None:
        raise ValueError(
            f"No vessel class is physically feasible at both {load_port['name']} "
            f"and {dest_port['name']} for a {parcel_size:,.0f} t parcel. "
            f"Refine parcel size or route."
        )

    db_conn = get_conn()
    distance_nm = get_distance(load_port, dest_port, db_conn=db_conn)

    forecast_svc = get_forecast_service()
    sub_index = vessel.get("baltic_index", "BDI")
    # Full 28-day forecast lets us look up per-voyage rates by day offset.
    fc = forecast_svc.forecast_index(sub_index, horizon=28)
    fc_p10, fc_p50, fc_p90 = fc["p10"], fc["p50"], fc["p90"]
    fc_start_str = fc.get("dates", [None])[0]
    fc_start_dt = datetime.strptime(fc_start_str, "%Y-%m-%d") if fc_start_str else start_dt

    def _rate_at(voyage_dt: datetime) -> tuple[float, float, float]:
        """Return (p10, p50, p90) freight index at the closest forecasted day.

        Voyages that fall outside the 28-day forecast window clamp to the
        last available point — this keeps 6- and 12-month contracts priced
        with the same model rather than falling back to a static number.
        """
        idx = max(0, (voyage_dt - fc_start_dt).days)
        idx = min(idx, len(fc_p50) - 1)
        return fc_p10[idx], fc_p50[idx], fc_p90[idx]

    # ── 4. Per-voyage scoring ─────────────────────────────────────────────
    service_speed = float(vessel.get("service_speed_kn", 13.5))
    sea_days = distance_nm / (service_speed * 24.0)
    disch_days = float(dest_port.get("avg_turnaround_hours", 72)) / 24.0
    load_days = float(load_port.get("avg_turnaround_hours", 48)) / 24.0
    voyage_duration_days = sea_days + load_days + disch_days

    schedule: list[dict[str, Any]] = []
    contract_landed_usd_per_t: list[float] = []
    total_landed_cost_inr = 0.0

    for i in range(voyage_count):
        eta_load_dt = start_dt + timedelta(days=i * spacing_days)
        eta_disch_dt = eta_load_dt + timedelta(days=voyage_duration_days)

        p10, p50, p90 = _rate_at(eta_load_dt)
        cost = compute_cost(
            cargo_tonnes=parcel_size,
            distance_nm=distance_nm,
            vessel=vessel,
            index_value=p50,
            crude_usd_bbl=crude_usd_bbl,
            usd_inr=usd_inr,
            commodity_usd_per_unit=comm_usd,
            dest_port_id=dest_port_id,
        )
        summary = cost["summary"]
        landed_inr_per_t = float(summary["landed_cost_per_tonne_inr"])
        landed_usd_per_t = float(summary["landed_cost_per_tonne_usd"])
        freight_inr_per_t = float(summary["freight_per_tonne_inr"])

        risk = compute_composite_risk(
            dest_port=dest_port,
            vessel_class=vessel,
            arrival_date=eta_disch_dt,
            forecast_p10=p10,
            forecast_p50=p50,
            forecast_p90=p90,
            cargo_tonnes=parcel_size,
        )

        voyage_landed_inr = landed_inr_per_t * parcel_size
        total_landed_cost_inr += voyage_landed_inr
        contract_landed_usd_per_t.append(landed_usd_per_t)

        schedule.append({
            "voyage_num": i + 1,
            "eta_load": eta_load_dt.strftime("%Y-%m-%d"),
            "eta_discharge": eta_disch_dt.strftime("%Y-%m-%d"),
            "vessel_class": vessel["class"],
            "parcel_tonnes": parcel_size,
            "index": sub_index,
            "index_p50": round(p50, 1),
            "freight_inr_per_t": round(freight_inr_per_t, 2),
            "landed_cost_inr_per_t": round(landed_inr_per_t, 2),
            "landed_cost_inr": round(voyage_landed_inr, 2),
            "risk_score": risk["score"],
            "risk_band": risk["band"],
        })

    # ── 5. Spot benchmark: same voyages priced at today's rate ────────────
    spot_p50 = fc_p50[0]
    spot_cost = compute_cost(
        cargo_tonnes=parcel_size,
        distance_nm=distance_nm,
        vessel=vessel,
        index_value=spot_p50,
        crude_usd_bbl=crude_usd_bbl,
        usd_inr=usd_inr,
        commodity_usd_per_unit=comm_usd,
        dest_port_id=dest_port_id,
    )
    spot_landed_inr_per_t = float(spot_cost["summary"]["landed_cost_per_tonne_inr"])
    total_spot_cost_inr = spot_landed_inr_per_t * parcel_size * voyage_count

    avg_landed_inr_per_t = total_landed_cost_inr / (parcel_size * voyage_count)
    savings_inr = total_spot_cost_inr - total_landed_cost_inr
    savings_pct = (savings_inr / total_spot_cost_inr * 100.0) if total_spot_cost_inr else 0.0

    # ── 6. Recommendation ─────────────────────────────────────────────────
    # >5% savings → lock the contract; otherwise spot is cheaper (or close
    # enough that the flexibility of spot outweighs the tiny lock-in gain).
    if savings_pct > 5.0:
        contract_label = f"{contract_months}m"
        rec_type = contract_label
        reason = (
            f"Contract locks a {savings_pct:.2f}% lower average landed cost "
            f"vs today's spot rate ({avg_landed_inr_per_t:,.0f} vs "
            f"{spot_landed_inr_per_t:,.0f} INR/t) across {voyage_count} voyages."
        )
    else:
        rec_type = "spot"
        if savings_pct >= 0:
            reason = (
                f"Contract saves only {savings_pct:.2f}% vs spot — below the 5% "
                f"threshold; spot preserves flexibility to re-tender if the "
                f"market softens."
            )
        else:
            reason = (
                f"Contract is {abs(savings_pct):.2f}% more expensive than spot "
                f"({avg_landed_inr_per_t:,.0f} vs {spot_landed_inr_per_t:,.0f} "
                f"INR/t); prefer spot chartering for this window."
            )

    return {
        "contract": {
            "type": f"{contract_months}m",
            "start": start_dt.strftime("%Y-%m-%d"),
            "end": end_dt.strftime("%Y-%m-%d"),
            "total_tonnes": round(total_tonnes, 2),
            "parcel_size": parcel_size,
            "voyage_count": voyage_count,
            "spacing_days": spacing_days,
            "load_port": {"id": load_port_id, "name": load_port["name"]},
            "dest_port": {"id": dest_port_id, "name": dest_port["name"]},
            "commodity": comm_display,
            "vessel_class": vessel["class"],
        },
        "schedule": schedule,
        "aggregate": {
            "total_landed_cost_inr": round(total_landed_cost_inr, 2),
            "avg_landed_cost_per_t_inr": round(avg_landed_inr_per_t, 2),
            "spot_comparison_inr_per_t": round(spot_landed_inr_per_t, 2),
            "spot_total_cost_inr": round(total_spot_cost_inr, 2),
            "savings_vs_spot_pct": round(savings_pct, 2),
            "savings_vs_spot_inr": round(savings_inr, 2),
        },
        "recommendation": {
            "contract_type": rec_type,
            "reason": reason,
        },
    }
