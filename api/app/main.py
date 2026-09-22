"""CargoX API – FastAPI application.

Endpoints:
  GET /health              → {"status": "ok"}
  GET /ports               → list of Indian discharge ports with constraints
  GET /vessel-classes      → list of dry-bulk vessel classes
  GET /freight/latest      → most recent BDI + sub-indices
  GET /commodities/latest  → latest pinksheet row
  GET /fx/usdinr           → latest USD/INR rate
  GET /vessels/live        → current AIS vessels (filterable by bbox, DWT)
  GET /vessels/open        → tonnage-list: vessels heading to East Coast India
  GET /vessels/{mmsi}      → full vessel profile by MMSI
  GET /debug/cost          → full landed-cost breakdown (temporary debug endpoint)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.db import (
    get_conn,
    get_load_port_by_id,
    get_load_ports,
    get_port_by_id,
    get_ports,
    get_vessel_class_by_name,
    get_vessel_classes,
    init_db,
    query_latest_bdi,
    query_latest_bdi_enriched,
    query_latest_pinksheet,
    query_latest_usdinr,
    query_live_vessels,
    query_port_congestion,
    query_vessel_by_mmsi,
    query_vessels_heading_india,
    query_fleet_status,
)
from app.engine.cost import CONFIG as COST_CONFIG, compute_cost
from app.engine.distance import get_distance
from app.engine.feasibility import feasible
from app.model.router import router as forecast_router
from app.model.service import get_forecast_service
from app.router_decision import router as decision_router
from app.router_weather import router as weather_router
import os

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — initialise DB and forecasting service on startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    get_forecast_service()
    yield


app = FastAPI(title="CargoX API", version="0.1.0", lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS – allow local dev and deployed Vercel frontends
# ---------------------------------------------------------------------------
cors_origins_env = os.getenv("CORS_ORIGINS", "*")
allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if "*" in allowed_origins else allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(forecast_router)
app.include_router(decision_router)
app.include_router(weather_router)


# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/fleet/status")
async def fleet_status():
    """Return live vs seeded fleet status."""
    return query_fleet_status()


# ── Reference data ────────────────────────────────────────────────────────

@app.get("/ports")
async def list_ports():
    return get_ports()


@app.get("/ports/{port_id}/congestion")
async def port_congestion(port_id: str):
    data = query_port_congestion(port_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Port '{port_id}' not found")
    return data


@app.get("/load_ports")
@app.get("/load-ports")
async def list_load_ports():
    return get_load_ports()


@app.get("/vessel-classes")
async def list_vessel_classes():
    return get_vessel_classes()


@app.get("/engine/config")
async def get_engine_config():
    """Return all cost engine coefficients, vessel class specs, and market baseline."""
    bdi = query_latest_bdi()
    pinksheet = query_latest_pinksheet()
    usdinr = query_latest_usdinr()

    return {
        **COST_CONFIG,
        "vessel_classes": get_vessel_classes(),
        "ports": get_ports(),
        "load_ports": get_load_ports(),
        "baseline_market": {
            "crude_usd_bbl": float(pinksheet.get("crude_avg_usd_bbl", 106.33)),
            "usd_inr": float(usdinr.get("usd_inr", 83.21)),
            "indices": {
                "BDI": float(bdi.get("BDI", 1422)),
                "BCI": float(bdi.get("BCI", 1652)),
                "BPI": float(bdi.get("BPI", 1609)),
                "BSI": float(bdi.get("BSI", 871)),
                "BHSI": float(bdi.get("BHSI", 1040)),
            },
            "commodities": {
                "coking_coal": float(pinksheet.get("coal_au_usd_mt", 182.54)),
                "iron_ore": float(pinksheet.get("iron_ore_usd_dmt", 107.81)),
                "thermal_coal": float(pinksheet.get("coal_sa_usd_mt", 137.01)),
            },
        },
    }


# ── Market data ───────────────────────────────────────────────────────────

@app.get("/freight/latest")
async def freight_latest():
    data = query_latest_bdi_enriched()
    if not data:
        raise HTTPException(status_code=404, detail="No BDI data loaded")
    return data


@app.get("/commodities/latest")
async def commodities_latest():
    data = query_latest_pinksheet()
    if not data:
        raise HTTPException(status_code=404, detail="No pinksheet data loaded")
    return data


@app.get("/fx")
@app.get("/fx/usdinr")
async def fx_usdinr():
    data = query_latest_usdinr()
    if not data:
        raise HTTPException(status_code=404, detail="No USD/INR data loaded")
    return data


# ── Live vessels (AIS) ────────────────────────────────────────────────────

@app.get("/vessels/live")
async def vessels_live(
    bbox: Optional[str] = Query(
        None,
        description=(
            "Bounding box as lat_min,lng_min,lat_max,lng_max. "
            "Example: 5,78,23,95 for Bay of Bengal."
        ),
    ),
    min_dwt: Optional[float] = Query(None, description="Min DWT filter (inferred from class)"),
    max_dwt: Optional[float] = Query(None, description="Max DWT filter (inferred from class)"),
):
    """Current live AIS vessels, optionally filtered by bounding box and DWT range."""
    parsed_bbox = None
    if bbox:
        try:
            parts = [float(x.strip()) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError
            parsed_bbox = tuple(parts)  # type: ignore[arg-type]
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="bbox must be 4 comma-separated floats: lat_min,lng_min,lat_max,lng_max",
            )

    vessels = query_live_vessels(bbox=parsed_bbox, min_dwt=min_dwt, max_dwt=max_dwt)
    return {"count": len(vessels), "vessels": vessels}


@app.get("/vessels/open")
async def vessels_open():
    """Tonnage-list style view: vessels heading toward East Coast India.

    Matches AIS destination field against known Indian port patterns,
    sorted by inferred ETA (earliest first).
    If live data is thin (no AIS key, few vessels), the list will be
    short or empty — that's expected and handled by demo-mode later.
    """
    vessels = query_vessels_heading_india()
    return {"count": len(vessels), "vessels": vessels}


@app.get("/vessels/{mmsi}")
async def vessel_profile(mmsi: int):
    """Full vessel profile: dims, draft, type, inferred class, position, destination, ETA."""
    vessel = query_vessel_by_mmsi(mmsi)
    if not vessel:
        raise HTTPException(status_code=404, detail=f"Vessel MMSI {mmsi} not found")

    # Enrich with matched vessel class details
    inferred = vessel.get("inferred_class")
    class_details = get_vessel_class_by_name(inferred) if inferred else None

    return {
        "vessel": vessel,
        "matched_class": class_details,
    }


# ── Debug: full cost breakdown ────────────────────────────────────────────

@app.get("/debug/cost")
@app.get("/engine/cost")
async def debug_cost(
    tonnes: float = Query(..., description="Cargo size in metric tonnes"),
    load: str = Query(..., description="Load port ID (e.g. port_hedland)"),
    dest: str = Query(..., description="Destination port ID (e.g. paradip)"),
    klass: str = Query(..., description="Vessel class name (e.g. Panamax)"),
    commodity: str = Query("coking_coal", description="Bulk commodity (coking_coal, iron_ore, thermal_coal)"),
):
    """Landed-cost engine endpoint — returns a full landed-cost and voyage breakdown."""

    # ── Resolve inputs ───────────────────────────────────────────────────
    load_port = get_load_port_by_id(load)
    if not load_port:
        raise HTTPException(status_code=404, detail=f"Load port '{load}' not found")

    dest_port = get_port_by_id(dest)
    if not dest_port:
        raise HTTPException(status_code=404, detail=f"Dest port '{dest}' not found")

    vessel = get_vessel_class_by_name(klass)
    if not vessel:
        raise HTTPException(status_code=404, detail=f"Vessel class '{klass}' not found")

    # ── Feasibility ──────────────────────────────────────────────────────
    feasibility = feasible(tonnes, dest_port, vessel)

    # ── Distance ─────────────────────────────────────────────────────────
    distance_nm = get_distance(load_port, dest_port, db_conn=get_conn())

    # ── Market data (latest from seed) ───────────────────────────────────
    bdi = query_latest_bdi()
    pinksheet = query_latest_pinksheet()
    fx = query_latest_usdinr()

    baltic_index = vessel["baltic_index"]
    index_value = bdi.get(baltic_index, 1000)  # fallback
    crude_usd_bbl = float(pinksheet.get("crude_avg_usd_bbl", 75.0))
    usd_inr = float(fx.get("usd_inr", 83.0))

    # Resolve commodity price based on requested bulk commodity
    comm_lower = commodity.lower()
    if comm_lower in ["iron_ore", "ironore", "ore"]:
        commodity_usd = float(pinksheet.get("iron_ore_usd_dmt", 105.0))
    elif comm_lower in ["coking_coal", "met_coal", "coal_au"]:
        commodity_usd = float(pinksheet.get("coal_au_usd_mt", 185.0))
    elif comm_lower in ["thermal_coal", "coal_sa", "coal"]:
        commodity_usd = float(pinksheet.get("coal_sa_usd_mt", 138.0))
    else:
        commodity_usd = float(pinksheet.get("iron_ore_usd_dmt", 105.0))

    # ── Cost breakdown ───────────────────────────────────────────────────
    breakdown = compute_cost(
        cargo_tonnes=tonnes,
        distance_nm=distance_nm,
        vessel=vessel,
        index_value=index_value,
        crude_usd_bbl=crude_usd_bbl,
        usd_inr=usd_inr,
        commodity_usd_per_unit=commodity_usd,
        dest_port_id=dest,
    )

    return {
        "inputs": {
            "cargo_tonnes": tonnes,
            "load_port": load_port["name"],
            "dest_port": dest_port["name"],
            "vessel_class": vessel["class"],
        },
        "feasibility": feasibility,
        "cost_breakdown": breakdown,
    }
