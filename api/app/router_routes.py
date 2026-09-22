"""FastAPI router for maritime sea route geometry and voyage economics.

Exposes:
  GET /routes/compute?load={load}&dest={dest}&tonnes={tonnes}&commodity={comm}&klass={klass}
    Returns GeoJSON LineString route coordinates from searoute, transit times,
    feasibility, freight costs, and timing signals.

  GET /routes/compare?load={load}&dests={d1,d2,...}&tonnes={tonnes}&commodity={comm}&klass={klass}
    Returns an array of route calculations (one per destination) for multi-route
    map overlay and destination comparison.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import searoute as sr
from fastapi import APIRouter, HTTPException, Query

from app.db import (
    get_load_port_by_id,
    get_load_ports,
    get_port_by_id,
    get_ports,
    get_vessel_class_by_name,
    get_vessel_classes,
    query_latest_pinksheet,
    query_latest_usdinr,
)
from app.engine.cost import compute_cost
from app.engine.feasibility import feasible
from app.engine.risk import compute_composite_risk
from app.model.service import get_forecast_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/routes", tags=["routes"])

# Default coordinates for fallback
DEFAULT_ORIGIN = {"id": "hay_point", "name": "Hay Point", "lat": -21.275, "lng": 149.2917}
DEFAULT_DEST = {
    "id": "paradip",
    "name": "Paradip",
    "lat": 20.2644,
    "lng": 86.6277,
    "max_draft_m": 14.5,
    "max_loa_m": 260,
    "max_beam_m": 40,
    "avg_turnaround_hours": 96,
}


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in nautical miles."""
    r_nm = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(r_nm * c, 1)


def compute_single_route(
    load_port_id: str,
    dest_port_id: str,
    cargo_tonnes: float = 50000.0,
    commodity: str = "coking_coal",
    klass: str = "all",
) -> dict[str, Any]:
    """Compute sea route geometry and vessel class scenarios for a load/dest pair."""
    # ── 1. Resolve Ports ──────────────────────────────────────────────────
    load_port = get_load_port_by_id(load_port_id) or get_port_by_id(load_port_id)
    if not load_port:
        for lp in get_load_ports():
            if lp["id"].lower() == load_port_id.lower() or lp["name"].lower() == load_port_id.lower():
                load_port = lp
                break
    if not load_port:
        raise HTTPException(status_code=404, detail=f"Load port '{load_port_id}' not found.")

    dest_port = get_port_by_id(dest_port_id) or get_load_port_by_id(dest_port_id)
    if not dest_port:
        for dp in get_ports():
            if dp["id"].lower() == dest_port_id.lower() or dp["name"].lower() == dest_port_id.lower():
                dest_port = dp
                break
    if not dest_port:
        raise HTTPException(status_code=404, detail=f"Destination port '{dest_port_id}' not found.")

    load_lng = float(load_port["lng"])
    load_lat = float(load_port["lat"])
    dest_lng = float(dest_port["lng"])
    dest_lat = float(dest_port["lat"])

    origin = [load_lng, load_lat]  # [lng, lat] for searoute & GeoJSON
    destination = [dest_lng, dest_lat]

    # ── 2. Sea Route Geometry (searoute with fallback) ────────────────────
    route_type = "searoute"
    try:
        route = sr.searoute(origin, destination, units="naut", append_orig_dest=True)
        coordinates = route["geometry"]["coordinates"]
        distance_nm = round(float(route["properties"]["length"]), 1)
    except Exception as exc:
        log.warning("searoute failed (%s -> %s): %s; using great-circle fallback", load_port_id, dest_port_id, exc)
        route_type = "great_circle_fallback"
        coordinates = [origin, destination]
        distance_nm = _haversine_nm(load_lat, load_lng, dest_lat, dest_lng)

    # ── 3. Market Rates Context ───────────────────────────────────────────
    pinksheet = query_latest_pinksheet()
    fx = query_latest_usdinr()
    crude_usd_bbl = float(pinksheet.get("crude_avg_usd_bbl", 75.0))
    usd_inr = float(fx.get("usd_inr", 83.2))

    clean_comm = commodity.lower().strip()
    if clean_comm in ["iron_ore", "ironore", "ore"]:
        comm_unit_usd = float(pinksheet.get("iron_ore_usd_dmt", 105.0))
    elif clean_comm in ["coking_coal", "met_coal", "coal_au"]:
        comm_unit_usd = float(pinksheet.get("coal_au_usd_mt", 185.0))
    elif clean_comm in ["thermal_coal", "coal_sa", "coal"]:
        comm_unit_usd = float(pinksheet.get("coal_sa_usd_mt", 138.0))
    else:
        comm_unit_usd = float(pinksheet.get("coal_au_usd_mt", 185.0))

    # ── 4. Vessel Class Scenarios ─────────────────────────────────────────
    all_classes = get_vessel_classes()
    if klass.lower() == "all":
        target_classes = all_classes
    else:
        matched = [v for v in all_classes if v["class"].lower() == klass.lower()]
        target_classes = matched if matched else all_classes

    forecast_svc = get_forecast_service()
    scenarios: list[dict[str, Any]] = []
    now_dt = datetime.now(timezone.utc)

    port_draft = float(dest_port.get("max_draft_m", 14.5))
    disch_days = float(dest_port.get("avg_turnaround_hours", 72)) / 24.0
    load_days = 2.0

    for v_class in target_classes:
        class_name = v_class["class"]
        sub_index = v_class.get("baltic_index", "BDI")

        # Feasibility check
        feas = feasible(cargo_tonnes, dest_port, v_class)
        is_feasible = bool(feas["feasible"])

        ves_draft = float(v_class.get("typical_draft_m", 12.0))
        draft_clearance = round(port_draft - ves_draft, 1)

        speed_kn = float(v_class.get("service_speed_kn", 13.5))
        sea_days = round(distance_nm / (speed_kn * 24.0), 1)
        total_voyage_days = round(sea_days + load_days + disch_days, 1)

        eta_dt = now_dt + timedelta(days=sea_days)
        eta_str = eta_dt.strftime("%Y-%m-%d")

        # Forecast P50 for today's index
        index_fc = forecast_svc.forecast_index(sub_index, horizon=28)
        idx_p50 = float(index_fc["p50"][0])

        # Cost engine computation
        cost_res = compute_cost(
            cargo_tonnes=cargo_tonnes,
            distance_nm=distance_nm,
            vessel=v_class,
            index_value=idx_p50,
            crude_usd_bbl=crude_usd_bbl,
            usd_inr=usd_inr,
            commodity_usd_per_unit=comm_unit_usd,
            dest_port_id=dest_port.get("id", "paradip"),
        )
        s_cost = cost_res["summary"]
        freight_per_tonne_inr = round(float(s_cost["freight_per_tonne_inr"]), 2)
        landed_cost_per_tonne_inr = round(float(s_cost["landed_cost_per_tonne_inr"]), 2)
        daily_hire_usd = round(float(cost_res["hire"]["daily_hire_usd"]))
        bunker_cost_usd = round(float(cost_res["bunker"]["bunker_cost_usd"]))

        # Risk score
        idx_end_p10 = float(index_fc["p10"][-1])
        idx_end_p50 = float(index_fc["p50"][-1])
        idx_end_p90 = float(index_fc["p90"][-1])
        risk = compute_composite_risk(
            dest_port=dest_port,
            vessel_class=v_class,
            arrival_date=eta_dt,
            forecast_p10=idx_end_p10,
            forecast_p50=idx_end_p50,
            forecast_p90=idx_end_p90,
            cargo_tonnes=cargo_tonnes,
        )
        risk_band = str(risk.get("band", "medium"))
        risk_score = round(float(risk.get("score", 50)))

        scenarios.append({
            "vessel_class": class_name,
            "feasible": is_feasible,
            "sea_days": sea_days,
            "total_voyage_days": total_voyage_days,
            "eta": eta_str,
            "freight_per_tonne_inr": freight_per_tonne_inr,
            "landed_cost_per_tonne_inr": landed_cost_per_tonne_inr,
            "risk_band": risk_band,
            "risk_score": risk_score,
            "daily_hire_usd": daily_hire_usd,
            "bunker_cost_usd": bunker_cost_usd,
            "draft_clearance_m": draft_clearance,
        })

    # ── 5. Recommended Class & Timing Signal ──────────────────────────────
    feasible_scenarios = [s for s in scenarios if s["feasible"]]
    if feasible_scenarios:
        winner = min(feasible_scenarios, key=lambda s: s["landed_cost_per_tonne_inr"])
    else:
        winner = min(scenarios, key=lambda s: s["landed_cost_per_tonne_inr"]) if scenarios else None

    recommended_class = winner["vessel_class"] if winner else "Supramax"

    # Evaluate 28-day slope for the recommended class's sub-index
    rec_vclass = get_vessel_class_by_name(recommended_class) or (all_classes[0] if all_classes else {})
    sub_index = rec_vclass.get("baltic_index", "BDI")
    rec_fc = forecast_svc.forecast_index(sub_index, horizon=28)
    idx_start = rec_fc["p50"][0]
    idx_end = rec_fc["p50"][-1]
    pct_change = ((idx_end - idx_start) / idx_start) * 100.0 if idx_start > 0 else 0.0

    p10_end = rec_fc["p10"][-1]
    p90_end = rec_fc["p90"][-1]
    spread_ratio = (p90_end - p10_end) / idx_end if idx_end > 0 else 0.0

    if spread_ratio > 0.25:
        timing_signal = "split"
        timing_reason = f"{sub_index} forecast shows volatility ({pct_change:+.1f}% over 28 days)"
    elif pct_change >= 2.5:
        timing_signal = "charter_now"
        timing_reason = f"{sub_index} forecasted to harden (+{pct_change:.1f}% over 28 days)"
    elif pct_change <= -2.5:
        timing_signal = "wait_spot"
        timing_reason = f"{sub_index} forecasted to soften ({pct_change:.1f}% over 28 days)"
    else:
        timing_signal = "split"
        timing_reason = f"{sub_index} forecast relatively flat ({pct_change:+.1f}% over 28 days)"

    return {
        "route_geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "route_type": route_type,
        "distance_nm": distance_nm,
        "load_port": {
            "id": load_port["id"],
            "name": load_port["name"],
            "lat": load_lat,
            "lng": load_lng,
        },
        "dest_port": {
            "id": dest_port["id"],
            "name": dest_port["name"],
            "lat": dest_lat,
            "lng": dest_lng,
        },
        "scenarios": scenarios,
        "recommended_class": recommended_class,
        "timing_signal": timing_signal,
        "timing_reason": timing_reason,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/compute")
async def compute_route(
    load: str = Query("hay_point", description="Loading port ID"),
    dest: str = Query("paradip", description="Destination port ID"),
    tonnes: float = Query(50000.0, description="Cargo parcel tonnes"),
    commodity: str = Query("coking_coal", description="Commodity type"),
    klass: str = Query("all", description="Vessel class or 'all'"),
) -> dict[str, Any]:
    """Compute sea route geometry and economics for a single trade lane."""
    return compute_single_route(
        load_port_id=load,
        dest_port_id=dest,
        cargo_tonnes=tonnes,
        commodity=commodity,
        klass=klass,
    )


@router.get("/compare")
async def compare_routes(
    load: str = Query("hay_point", description="Loading port ID"),
    dests: str = Query("paradip,visakhapatnam,haldia", description="Comma-separated destination port IDs"),
    tonnes: float = Query(50000.0, description="Cargo parcel tonnes"),
    commodity: str = Query("coking_coal", description="Commodity type"),
    klass: str = Query("Supramax", description="Vessel class or 'all'"),
) -> list[dict[str, Any]]:
    """Compare multiple sea routes from a single load port across multiple destinations."""
    dest_ids = [d.strip() for d in dests.split(",") if d.strip()]
    if not dest_ids:
        raise HTTPException(status_code=400, detail="No destination port IDs provided.")

    results: list[dict[str, Any]] = []
    for d_id in dest_ids:
        try:
            res = compute_single_route(
                load_port_id=load,
                dest_port_id=d_id,
                cargo_tonnes=tonnes,
                commodity=commodity,
                klass=klass,
            )
            results.append(res)
        except Exception as exc:
            log.warning("Route comparison failed for %s -> %s: %s", load, d_id, exc)

    return results
