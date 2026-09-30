"""Contract planner router — POST /contract.

Additive endpoint that never touches /decision. Maps `ValueError` from the
engine to HTTP 400 (bad input) and anything else to HTTP 500 so a broken
contract call cannot take down the API.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.engine.multi_voyage import plan_contract

log = logging.getLogger(__name__)

router = APIRouter(tags=["contract"])


class ContractRequest(BaseModel):
    annual_tonnes: float = Field(..., gt=0, description="Total commitment across a full year (t)")
    parcel_size: float = Field(..., gt=0, description="Cargo per voyage (t)")
    commodity: str = Field("coking_coal", description="'coking_coal' | 'iron_ore' | 'thermal_coal'")
    load_port_id: str = Field(..., description="Loading port id (see /load-ports)")
    dest_port_id: str = Field(..., description="Discharge port id (see /ports)")
    contract_months: int = Field(6, ge=1, le=12, description="Contract length in months (1–12)")
    start_date: str = Field(..., description="Contract start date (YYYY-MM-DD)")


@router.post("/contract")
async def evaluate_contract(req: ContractRequest):
    """Plan a multi-voyage contract and compare it to today's spot benchmark."""
    try:
        return plan_contract(
            annual_tonnes=req.annual_tonnes,
            parcel_size=req.parcel_size,
            commodity=req.commodity,
            load_port_id=req.load_port_id,
            dest_port_id=req.dest_port_id,
            contract_months=req.contract_months,
            start_date=req.start_date,
        )
    except ValueError as exc:
        # Friendly, actionable message for bad inputs.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover — defensive
        log.exception("contract planner failed")
        raise HTTPException(
            status_code=500,
            detail=f"contract planner failed: {exc}",
        ) from exc
