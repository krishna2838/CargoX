"""CargoX Decision Engine.

Integrates feasibility, probabilistic 28-day freight forecasting, deterministic
voyage costing, and multi-driver risk scoring to produce a ranked, fully traceable
procurement recommendation for Indian bulk importers.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from app.db import (
    get_conn,
    get_load_port_by_id,
    get_port_by_id,
    get_vessel_classes,
    query_latest_pinksheet,
    query_latest_usdinr,
    query_live_vessels,
)
from app.engine.cost import compute_cost
from app.engine.distance import get_distance
from app.engine.feasibility import feasible
from app.engine.risk import compute_composite_risk
from app.model.service import get_forecast_service

log = logging.getLogger(__name__)


def run_decision_pipeline(
    cargo_tonnes: float,
    commodity: str,
    load_port_id: str,
    dest_port_id: str,
    laycan_start: str,
    laycan_end: str,
    horizon_days: int = 28,
) -> dict[str, Any]:
    """Execute the full end-to-end decision and ranking pipeline."""
    # ── 1. Resolve Ports & Baseline Context ──────────────────────────────────
    load_port = get_load_port_by_id(load_port_id)
    if not load_port:
        raise ValueError(f"Load port '{load_port_id}' not found.")

    dest_port = get_port_by_id(dest_port_id)
    if not dest_port:
        raise ValueError(f"Destination port '{dest_port_id}' not found.")

    db_conn = get_conn()
    distance_nm = get_distance(load_port, dest_port, db_conn=db_conn)

    # Resolve dates
    try:
        start_dt = datetime.strptime(laycan_start, "%Y-%m-%d")
        end_dt = datetime.strptime(laycan_end, "%Y-%m-%d")
    except ValueError:
        start_dt = datetime.now() + timedelta(days=7)
        end_dt = start_dt + timedelta(days=10)

    # ── 2. Exogenous Market Rates ────────────────────────────────────────────
    pinksheet = query_latest_pinksheet()
    fx = query_latest_usdinr()
    crude_usd_bbl = float(pinksheet.get("crude_avg_usd_bbl", 75.0))
    usd_inr = float(fx.get("usd_inr", 83.2))

    # Resolve commodity purchase price (Pink Sheet)
    clean_comm = commodity.lower().strip()
    if clean_comm in ["iron_ore", "ironore", "ore"]:
        comm_unit_usd = float(pinksheet.get("iron_ore_usd_dmt", 105.0))
        comm_display = "Iron Ore (62% Fe CFR)"
    elif clean_comm in ["coking_coal", "met_coal", "coal_au"]:
        comm_unit_usd = float(pinksheet.get("coal_au_usd_mt", 185.0))
        comm_display = "Premium Coking Coal (Australia FOB)"
    elif clean_comm in ["thermal_coal", "coal_sa", "coal"]:
        comm_unit_usd = float(pinksheet.get("coal_sa_usd_mt", 138.0))
        comm_display = "Thermal Coal (South Africa FOB)"
    else:
        comm_unit_usd = float(pinksheet.get("iron_ore_usd_dmt", 105.0))
        comm_display = clean_comm.title()

    commodity_cost_per_tonne_usd = round(comm_unit_usd, 2)
    commodity_cost_per_tonne_inr = round(comm_unit_usd * usd_inr, 2)

    # ── 3. Candidate Vessels Evaluation ──────────────────────────────────────
    forecast_svc = get_forecast_service()
    all_classes = get_vessel_classes()
    scenarios: list[dict[str, Any]] = []

    # Check if any vessel can make the laycan
    any_laycan_met = False

    for v_class in all_classes:
        class_name = v_class["class"]
        sub_index = v_class.get("baltic_index", "BDI")

        # Feasibility check
        feas = feasible(cargo_tonnes, dest_port, v_class)
        is_feasible = bool(feas["feasible"])

        # Structured feasibility detail
        port_draft = dest_port["max_draft_m"]
        ves_draft = v_class["typical_draft_m"]
        port_loa = dest_port["max_loa_m"]
        ves_loa = v_class["typical_loa_m"]
        port_beam = dest_port["max_beam_m"]
        ves_beam = v_class["typical_beam_m"]
        dwt_min = v_class["dwt_min"]
        dwt_max = v_class["dwt_max"]

        if not is_feasible:
            if ves_draft > port_draft:
                bottleneck = "draft"
                b_diff = ves_draft - port_draft
                summary = f"Draft {ves_draft}m exceeds {dest_port['name']} max {port_draft}m by {b_diff:.1f}m"
            elif ves_loa > port_loa:
                bottleneck = "loa"
                b_diff = ves_loa - port_loa
                summary = f"LOA {ves_loa}m exceeds {dest_port['name']} max {port_loa}m by {b_diff:.1f}m"
            elif ves_beam > port_beam:
                bottleneck = "beam"
                b_diff = ves_beam - port_beam
                summary = f"Beam {ves_beam}m exceeds {dest_port['name']} max {port_beam}m by {b_diff:.1f}m"
            else:
                bottleneck = "physical"
                summary = "Physical berth constraint violation"
        else:
            if cargo_tonnes > dwt_max:
                bottleneck = "capacity"
                summary = f"Parcel ({cargo_tonnes:,.0f}t) exceeds single-voyage capacity ({dwt_max:,}t DWT) — requires multiple voyages"
            elif cargo_tonnes < dwt_min:
                bottleneck = "capacity"
                summary = f"Vessel oversized for parcel ({cargo_tonnes:,.0f}t < {dwt_min:,}t min DWT)"
            else:
                bottleneck = "none"
                summary = f"Fully compliant with {dest_port['name']} physical limits and parcel size"

        feasibility_detail = {
            "feasible": is_feasible,
            "primary_bottleneck": bottleneck,
            "summary": summary,
            "reasons": feas["reasons"],
        }

        # Transit & ETA
        speed_kn = v_class.get("service_speed_kn", 13.5)
        sea_days = distance_nm / (speed_kn * 24.0)
        # Port days from turnaround + loading
        load_days = 2.0
        disch_days = dest_port.get("avg_turnaround_hours", 72) / 24.0
        total_voyage_days = sea_days + load_days + disch_days

        eta_dt = start_dt + timedelta(days=sea_days)
        eta_str = eta_dt.strftime("%Y-%m-%d")

        # Laycan compatibility check
        if start_dt <= eta_dt <= end_dt:
            laycan_compatible = True
            laycan_status = "within_window"
            days_diff = 0
            any_laycan_met = True
        elif eta_dt < start_dt:
            laycan_compatible = True
            laycan_status = "arrives_early"
            days_diff = (start_dt - eta_dt).days
            any_laycan_met = True
        else:
            laycan_compatible = False
            laycan_status = "misses_laycan"
            days_diff = (eta_dt - end_dt).days

        # Forecast for this class's sub-index
        index_fc = forecast_svc.forecast_index(sub_index, horizon=horizon_days)
        idx_today = index_fc["p50"][0]
        idx_p10_today = index_fc["p10"][0]
        idx_p90_today = index_fc["p90"][0]

        idx_end_p50 = index_fc["p50"][-1]
        idx_end_p10 = index_fc["p10"][-1]
        idx_end_p90 = index_fc["p90"][-1]

        # Cost today (P10, P50, P90)
        cost_today_p50 = compute_cost(
            cargo_tonnes=cargo_tonnes,
            distance_nm=distance_nm,
            vessel=v_class,
            index_value=idx_today,
            crude_usd_bbl=crude_usd_bbl,
            usd_inr=usd_inr,
            commodity_usd_per_unit=comm_unit_usd,
            dest_port_id=dest_port_id,
        )

        cost_today_p10 = compute_cost(
            cargo_tonnes=cargo_tonnes,
            distance_nm=distance_nm,
            vessel=v_class,
            index_value=idx_p10_today,
            crude_usd_bbl=crude_usd_bbl,
            usd_inr=usd_inr,
            commodity_usd_per_unit=comm_unit_usd,
            dest_port_id=dest_port_id,
        )

        cost_today_p90 = compute_cost(
            cargo_tonnes=cargo_tonnes,
            distance_nm=distance_nm,
            vessel=v_class,
            index_value=idx_p90_today,
            crude_usd_bbl=crude_usd_bbl,
            usd_inr=usd_inr,
            commodity_usd_per_unit=comm_unit_usd,
            dest_port_id=dest_port_id,
        )

        s_p50 = cost_today_p50["summary"]
        s_p10 = cost_today_p10["summary"]
        s_p90 = cost_today_p90["summary"]

        # Risk scoring
        risk = compute_composite_risk(
            dest_port=dest_port,
            vessel_class=v_class,
            arrival_date=eta_dt,
            forecast_p10=idx_end_p10,
            forecast_p50=idx_end_p50,
            forecast_p90=idx_end_p90,
            cargo_tonnes=cargo_tonnes,
        )

        # Attach matching live vessel example
        example_ship = _find_live_vessel_example(class_name)

        # 28-day daily trajectory for lane
        lane_fc = forecast_svc.forecast_lane(
            cargo_tonnes=cargo_tonnes,
            load_port=load_port,
            dest_port=dest_port,
            vessel_class=v_class,
            commodity=clean_comm,
            horizon=horizon_days,
            db_conn=db_conn,
            crude_usd_bbl=crude_usd_bbl,
            usd_inr=usd_inr,
            commodity_usd=comm_unit_usd,
        )

        # Composite ranking score:
        # Lower score is better. Penalize infeasible severely, penalize late laycan, penalize high risk.
        base_cost = s_p50["landed_cost_per_tonne_inr"]
        if not is_feasible:
            rank_score = 999999.0 + (ves_draft - port_draft) * 1000.0
        else:
            risk_penalty = 1.0 + (risk["score"] / 400.0)
            laycan_penalty = 1.05 if not laycan_compatible else 1.0
            capacity_penalty = 1.08 if (cargo_tonnes < dwt_min or cargo_tonnes > dwt_max) else 1.0
            rank_score = base_cost * risk_penalty * laycan_penalty * capacity_penalty

        scenarios.append({
            "vessel_class": class_name,
            "sub_index": sub_index,
            "rank_score": rank_score,
            "feasible": is_feasible,
            "feasibility_detail": feasibility_detail,
            "costs": {
                "commodity_cost_per_tonne_inr": commodity_cost_per_tonne_inr,
                "commodity_cost_per_tonne_usd": commodity_cost_per_tonne_usd,
                "freight_cost_per_tonne_inr": {
                    "p10": s_p10["freight_per_tonne_inr"],
                    "p50": s_p50["freight_per_tonne_inr"],
                    "p90": s_p90["freight_per_tonne_inr"],
                },
                "freight_cost_per_tonne_usd": {
                    "p10": s_p10["freight_per_tonne_usd"],
                    "p50": s_p50["freight_per_tonne_usd"],
                    "p90": s_p90["freight_per_tonne_usd"],
                },
                "landed_cost_per_tonne_inr": {
                    "p10": s_p10["landed_cost_per_tonne_inr"],
                    "p50": s_p50["landed_cost_per_tonne_inr"],
                    "p90": s_p90["landed_cost_per_tonne_inr"],
                },
                "landed_cost_per_tonne_usd": {
                    "p10": s_p10["landed_cost_per_tonne_usd"],
                    "p50": s_p50["landed_cost_per_tonne_usd"],
                    "p90": s_p90["landed_cost_per_tonne_usd"],
                },
                "daily_hire_usd_p50": cost_today_p50["hire"]["daily_hire_usd"],
                "bunker_cost_usd_p50": cost_today_p50["bunker"]["bunker_cost_usd"],
                "port_charges_usd": cost_today_p50["port"]["port_charges_usd"],
            },
            "voyage": {
                "distance_nm": round(distance_nm, 1),
                "service_speed_kn": speed_kn,
                "sea_days": round(sea_days, 1),
                "port_days": round(load_days + disch_days, 1),
                "total_voyage_days": round(total_voyage_days, 1),
                "eta": eta_str,
                "laycan_compatible": laycan_compatible,
                "laycan_status": laycan_status,
                "days_offset_laycan": days_diff,
            },
            "risk": risk,
            "example_vessel": example_ship,
            "forecast_trajectory": {
                "dates": lane_fc["dates"],
                "freight_inr_p50": lane_fc["freight_per_tonne_inr"]["p50"],
                "landed_inr_p50": lane_fc["landed_cost_per_tonne_inr"]["p50"],
                "freight_inr_p10": lane_fc["freight_per_tonne_inr"]["p10"],
                "freight_inr_p90": lane_fc["freight_per_tonne_inr"]["p90"],
            },
        })

    # Sort scenarios by rank_score ascending
    scenarios.sort(key=lambda s: s["rank_score"])
    for idx, s in enumerate(scenarios):
        s["rank"] = idx + 1

    # Identify winner (first feasible scenario, or top scenario if none feasible)
    feasible_scenarios = [s for s in scenarios if s["feasible"]]
    winner = feasible_scenarios[0] if feasible_scenarios else scenarios[0]
    runner_up = feasible_scenarios[1] if len(feasible_scenarios) > 1 else (scenarios[1] if len(scenarios) > 1 else None)

    # ── 4. "When to Charter" Timing Signal with Uncertainty Guard ─────────────
    # Evaluate slope of winner's sub-index
    win_sub_index = winner["sub_index"]
    win_fc = forecast_svc.forecast_index(win_sub_index, horizon=horizon_days)

    idx_start = win_fc["p50"][0]
    idx_end = win_fc["p50"][-1]
    pct_change = ((idx_end - idx_start) / idx_start) * 100.0 if idx_start > 0 else 0.0

    # Uncertainty check: P90–P10 spread ratio at horizon end
    p10_end = win_fc["p10"][-1]
    p90_end = win_fc["p90"][-1]
    spread_ratio = (p90_end - p10_end) / idx_end if idx_end > 0 else 0.0
    spread_pct = spread_ratio * 100.0

    high_uncertainty = spread_ratio > 0.25

    if high_uncertainty:
        timing = "split"
        timing_reason = (
            f"Sub-index {win_sub_index} shows {pct_change:+.1f}% slope, but high forecast uncertainty "
            f"(P90–P10 spread is {spread_pct:.1f}% > 25.0% threshold). "
            f"Recommend split procurement (fix 50% on index/COA now, leave 50% on spot to hedge volatility)."
        )
        timing_confidence = "moderate"
    else:
        if pct_change >= 2.5:
            timing = "charter_now"
            timing_reason = (
                f"Sub-index {win_sub_index} is forecasted to harden by {pct_change:+.1f}% over the next "
                f"{horizon_days} days with tight confidence bounds ({spread_pct:.1f}% spread ≤ 25%). "
                f"Recommend locking charter freight now to protect against impending rate increases."
            )
            timing_confidence = "high"
        elif pct_change <= -2.5:
            timing = "wait_spot"
            timing_reason = (
                f"Sub-index {win_sub_index} is forecasted to decline by {pct_change:.1f}% over the next "
                f"{horizon_days} days. Recommend waiting and chartering on the spot market near laycan date."
            )
            timing_confidence = "high"
        else:
            timing = "split"
            timing_reason = (
                f"Sub-index {win_sub_index} forecast is relatively flat ({pct_change:+.1f}% change). "
                f"Recommend split procurement: secure partial volume on contract and float balance on spot."
            )
            timing_confidence = "moderate"

    # ── 5. Concrete Number-Rich Narrative Explanation ─────────────────────────
    win_class = winner["vessel_class"]
    win_landed = winner["costs"]["landed_cost_per_tonne_inr"]["p50"]
    win_freight = winner["costs"]["freight_cost_per_tonne_inr"]["p50"]
    win_draft = dest_port["max_draft_m"] - winner["feasibility_detail"]["reasons"][0].split()[-1] if False else (
        dest_port["max_draft_m"] - [v["typical_draft_m"] for v in all_classes if v["class"] == win_class][0]
    )
    win_transit = winner["voyage"]["sea_days"]

    explanation_parts = [
        f"{win_class} ranks #1 for transporting {cargo_tonnes:,.0f} MT of {comm_display} from {load_port['name']} to {dest_port['name']}.",
        f"Landed cost is ₹{win_landed:,.0f}/t (freight: ₹{win_freight:,.0f}/t, commodity: ₹{commodity_cost_per_tonne_inr:,.0f}/t).",
    ]

    if runner_up:
        diff_inr = runner_up["costs"]["landed_cost_per_tonne_inr"]["p50"] - win_landed
        runner_class = runner_up["vessel_class"]
        if runner_up["feasible"]:
            if diff_inr > 0:
                explanation_parts.append(
                    f"It saves ₹{diff_inr:,.0f}/t over {runner_class} (₹{runner_up['costs']['landed_cost_per_tonne_inr']['p50']:,.0f}/t), which is {runner_up['feasibility_detail']['summary'].lower()}."
                )
            else:
                explanation_parts.append(
                    f"Although {runner_class} has a theoretical rate of ₹{runner_up['costs']['landed_cost_per_tonne_inr']['p50']:,.0f}/t, {runner_up['feasibility_detail']['summary'].lower()}."
                )
        else:
            explanation_parts.append(
                f"Alternative {runner_class} is physically disqualified because {runner_up['feasibility_detail']['summary'].lower()}."
            )

    # Compare against next larger feasible class if available
    larger_opts = [
        s for s in feasible_scenarios
        if s["vessel_class"] != win_class and s["costs"]["landed_cost_per_tonne_inr"]["p50"] > win_landed
    ]
    if larger_opts:
        next_opt = larger_opts[0]
        next_diff = next_opt["costs"]["landed_cost_per_tonne_inr"]["p50"] - win_landed
        explanation_parts.append(
            f"Compared to larger options like {next_opt['vessel_class']} (₹{next_opt['costs']['landed_cost_per_tonne_inr']['p50']:,.0f}/t), {win_class} saves ₹{next_diff:,.0f}/t without freight deadweight penalty."
        )

    explanation_parts.append(
        f"Clearance at {dest_port['name']} offers a comfortable {win_draft:.1f}m draft margin over typical operating draft. Transit requires {win_transit:.1f} sea days ({winner['voyage']['total_voyage_days']:.1f} total voyage days)."
    )

    # Laycan advice if late
    if not any_laycan_met:
        transit_days = winner["voyage"]["sea_days"]
        suggested_end = (start_dt + timedelta(days=int(transit_days) + 3)).strftime("%Y-%m-%d")
        explanation_parts.append(
            f"NOTE ON LAYCAN: All candidate vessels arrive after the laycan window closes on {laycan_end} (transit from {load_port['name']} requires {transit_days:.1f} sea days). Recommend extending laycan to at least {suggested_end}."
        )

    explanation_parts.append(
        f"Chartering call: {timing.upper()} ({timing_reason})."
    )

    explanation_str = " ".join(explanation_parts)

    return {
        "query": {
            "cargo_tonnes": cargo_tonnes,
            "commodity": clean_comm,
            "load_port": load_port,
            "dest_port": dest_port,
            "laycan_start": laycan_start,
            "laycan_end": laycan_end,
            "horizon_days": horizon_days,
            "assumed_crude_usd_bbl": crude_usd_bbl,
            "assumed_usd_inr": usd_inr,
            "commodity_unit_price_usd": comm_unit_usd,
        },
        "recommendation": {
            "vessel_class": win_class,
            "example_vessel": winner.get("example_vessel"),
            "timing": timing,
            "timing_confidence": timing_confidence,
            "timing_reason": timing_reason,
            "landed_cost_p50_inr": win_landed,
            "freight_cost_p50_inr": win_freight,
            "commodity_cost_inr": commodity_cost_per_tonne_inr,
            "eta": winner["voyage"]["eta"],
            "risk_score": winner["risk"]["score"],
            "risk_band": winner["risk"]["band"],
            "laycan_compatible": winner["voyage"]["laycan_compatible"],
        },
        "scenarios": scenarios,
        "forecast_summary": {
            "sub_index": win_sub_index,
            "today_p50": round(idx_start, 1),
            "end_p50": round(idx_end, 1),
            "pct_change_horizon": round(pct_change, 2),
            "spread_pct_end": round(spread_pct, 1),
            "high_uncertainty": high_uncertainty,
        },
        "explanation": explanation_str,
    }


def _find_live_vessel_example(vessel_class_name: str) -> dict[str, Any] | None:
    """Find a representative active ship from the live_vessels database."""
    try:
        vessels = query_live_vessels()
        matches = [v for v in vessels if v.get("inferred_class") == vessel_class_name]
        if not matches:
            # If no direct class match, check by length
            classes_loa = {
                "Handysize": (100, 170),
                "Supramax": (170, 215),
                "Panamax": (215, 235),
                "Kamsarmax": (225, 235),
                "Capesize": (260, 400),
            }
            loa_range = classes_loa.get(vessel_class_name, (0, 0))
            matches = [
                v for v in vessels
                if v.get("loa") and loa_range[0] <= v["loa"] <= loa_range[1]
            ]

        if matches:
            # Prefer ship with valid name and speed > 0
            best = sorted(
                matches,
                key=lambda x: (bool(x.get("name")), (x.get("speed") or 0) > 0),
                reverse=True,
            )[0]
            return {
                "name": best.get("name") or f"Active {vessel_class_name}",
                "mmsi": best.get("mmsi"),
                "imo": best.get("imo"),
                "callsign": best.get("callsign"),
                "loa": best.get("loa"),
                "beam": best.get("beam"),
                "draft": best.get("draft"),
                "speed": best.get("speed"),
                "latitude": best.get("latitude"),
                "longitude": best.get("longitude"),
                "destination": best.get("destination"),
                "eta": best.get("eta"),
                "last_seen": best.get("last_seen"),
            }
    except Exception as exc:
        log.warning("Could not query live vessels for example ship: %s", exc)

    return None
