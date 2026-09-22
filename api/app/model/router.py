"""FastAPI router for freight forecasting endpoints.

Endpoints:
  GET /forecast
      Baltic dry bulk index forecast (BDI, BCI, BPI, BSI, BHSI) with P10/P50/P90 bands.
  GET /forecast/lane
      Direct translation of forecasted Baltic sub-index into daily ₹/tonne and $/tonne
      freight and landed-cost forecasts for a specific cargo shipment route.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.db import (
    get_conn,
    get_load_port_by_id,
    get_port_by_id,
    get_vessel_class_by_name,
)
from app.model.service import get_forecast_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/forecast", tags=["forecasting"])


@router.get("")
async def get_forecast(
    index: str = Query(
        "BDI",
        description="Baltic dry bulk index name: BDI, BCI, BPI, BSI, or BHSI",
    ),
    horizon: int = Query(
        28,
        ge=1,
        le=28,
        description="Forecast horizon in days (1 to 28)",
    ),
):
    """28-day probabilistic forecast for Baltic Exchange indices with P10/P50/P90 bands.

    Uses an autoregressive LightGBM quantile regression model trained on
    historical Baltic Exchange data, World Bank Pink Sheet commodity prices
    (crude, iron ore, coal), and USD/INR exchange rates.
    """
    svc = get_forecast_service()
    clean_index = index.strip().upper()
    valid_indices = ["BDI", "BCI", "BPI", "BSI", "BHSI"]
    if clean_index not in valid_indices:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid index '{index}'. Supported indices are: {', '.join(valid_indices)}",
        )

    return svc.forecast_index(clean_index, horizon=horizon)


@router.get("/lane")
async def get_lane_forecast(
    tonnes: float = Query(..., description="Cargo volume in metric tonnes (e.g. 75000)"),
    load: str = Query(..., description="Load port ID (e.g. port_hedland, newcastle, dampier)"),
    dest: str = Query(..., description="Discharge port ID (e.g. paradip, visakhapatnam, dhamra)"),
    klass: str = Query(..., description="Vessel class (e.g. Panamax, Capesize, Supramax, Handysize, Kamsarmax)"),
    commodity: str = Query(..., description="Commodity type: iron_ore, coking_coal, or thermal_coal"),
    horizon: int = Query(28, ge=1, le=28, description="Forecast horizon in days (1 to 28)"),
):
    """Lane-specific freight and landed cost probabilistic forecast (₹/tonne and $/tonne).

    Translates the vessel class's sub-index (e.g., BPI for Panamax, BCI for Capesize)
    forecast into voyage hire, bunker consumption, and port charges via the
    deterministic cost engine. Clearly labeled as "estimated (index-derived)".
    """
    # ── Resolve entities ─────────────────────────────────────────────────────
    load_port = get_load_port_by_id(load)
    if not load_port:
        raise HTTPException(status_code=404, detail=f"Load port '{load}' not found.")

    dest_port = get_port_by_id(dest)
    if not dest_port:
        raise HTTPException(status_code=404, detail=f"Destination port '{dest}' not found.")

    vessel_class = get_vessel_class_by_name(klass)
    if not vessel_class:
        raise HTTPException(status_code=404, detail=f"Vessel class '{klass}' not found.")

    valid_commodities = ["iron_ore", "coking_coal", "thermal_coal"]
    clean_commodity = commodity.strip().lower()
    if clean_commodity not in valid_commodities:
        # Also accept common aliases
        if clean_commodity in ["ironore", "ore"]:
            clean_commodity = "iron_ore"
        elif clean_commodity in ["met_coal", "coal_au"]:
            clean_commodity = "coking_coal"
        elif clean_commodity in ["coal_sa", "coal"]:
            clean_commodity = "thermal_coal"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid commodity '{commodity}'. Supported commodities: {', '.join(valid_commodities)}",
            )

    svc = get_forecast_service()
    try:
        lane_fc = svc.forecast_lane(
            cargo_tonnes=tonnes,
            load_port=load_port,
            dest_port=dest_port,
            vessel_class=vessel_class,
            commodity=clean_commodity,
            horizon=horizon,
            db_conn=get_conn(),
        )
        return lane_fc
    except Exception as exc:
        log.exception("Error calculating lane forecast")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to calculate lane forecast: {exc}",
        )
