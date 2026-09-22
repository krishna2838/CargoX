"""FastAPI router for the CargoX Decision Engine.

Exposes:
  POST /decision
    Synthesizes vessel feasibility, 28-day probabilistic freight forecasting,
    voyage cost calculation, and multi-factor risk scoring into an executive
    procurement recommendation.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.engine.decision import run_decision_pipeline

log = logging.getLogger(__name__)

router = APIRouter(prefix="/decision", tags=["decision"])


class DecisionRequest(BaseModel):
    cargo_tonnes: float = Field(
        ...,
        gt=0,
        description="Cargo parcel size in metric tonnes (e.g. 50000, 75000, 160000)",
        examples=[50000],
    )
    commodity: str = Field(
        "coking_coal",
        description="Commodity type: 'coking_coal', 'iron_ore', or 'thermal_coal'",
        examples=["coking_coal"],
    )
    load_port_id: str = Field(
        ...,
        description="Load port ID (e.g. 'hay_point', 'port_hedland', 'newcastle', 'gladstone')",
        examples=["hay_point"],
    )
    dest_port_id: str = Field(
        ...,
        description="Discharge port ID on India East Coast (e.g. 'paradip', 'visakhapatnam', 'dhamra', 'gangavaram')",
        examples=["paradip"],
    )
    laycan_start: str = Field(
        ...,
        description="Laycan delivery window start date (YYYY-MM-DD)",
        examples=["2026-10-05"],
    )
    laycan_end: str = Field(
        ...,
        description="Laycan delivery window end date (YYYY-MM-DD)",
        examples=["2026-10-25"],
    )
    horizon_days: int = Field(
        28,
        ge=1,
        le=28,
        description="Forecast horizon in days (default 28)",
        examples=[28],
    )


@router.post("")
async def evaluate_decision(req: DecisionRequest) -> dict[str, Any]:
    """Evaluate procurement scenarios and return ranked recommendations.

    Integrates:
      1. Vessel class physical & capacity feasibility
      2. Multi-horizon LightGBM sub-index forecasts
      3. Deterministic voyage & landed costs
      4. 4-factor risk scoring (congestion, cyclone, volatility, draft)
      5. 'When to charter' timing signal with uncertainty guard
      6. Concrete, number-rich narrative explanation
    """
    try:
        decision_result = run_decision_pipeline(
            cargo_tonnes=req.cargo_tonnes,
            commodity=req.commodity,
            load_port_id=req.load_port_id,
            dest_port_id=req.dest_port_id,
            laycan_start=req.laycan_start,
            laycan_end=req.laycan_end,
            horizon_days=req.horizon_days,
        )
        return decision_result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        log.exception("Error executing decision engine pipeline")
        raise HTTPException(
            status_code=500,
            detail=f"Internal decision engine error: {exc}",
        )
