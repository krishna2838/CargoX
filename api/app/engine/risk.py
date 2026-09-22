"""Risk engine — evaluates operational, meteorological, market, and physical risks.

Produces a composite 0-100 risk score and qualitative risk band ('low', 'medium', 'high')
composed of 4 transparent, quantifiable drivers:
  1. Port Congestion Risk (based on discharge turnaround hours)
  2. Cyclone & Weather Seasonality Risk (calibrated to Bay of Bengal cyclonic windows)
  3. Freight Market Volatility Risk (derived from P90–P10 forecast spread)
  4. Draft Margin & Capacity Fit Risk (physical under-keel clearance and parcel fit)
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import numpy as np

log = logging.getLogger(__name__)


def compute_composite_risk(
    dest_port: dict[str, Any],
    vessel_class: dict[str, Any],
    arrival_date: datetime | str,
    forecast_p10: float,
    forecast_p50: float,
    forecast_p90: float,
    cargo_tonnes: float,
) -> dict[str, Any]:
    """Compute 0-100 composite risk score with explicit driver contributions.

    Returns
    -------
    dict:
      {
        "score": int (0-100),
        "band": "low" | "medium" | "high",
        "drivers": [
          { "name": str, "score": int, "weight": float, "contribution": float, "description": str }
        ]
      }
    """
    # ── 1. Port Congestion Risk (Weight: 30%) ────────────────────────────────
    avg_turnaround = dest_port.get("expected_wait_hours") or dest_port.get("avg_turnaround_hours", 72)
    # Scale: ≤48h → 15 (fast), 72h → 40 (normal), 96h → 65 (elevated), ≥120h → 90 (severe)
    if avg_turnaround <= 48:
        congestion_score = 15.0
        c_desc = f"Fast turnaround (~{avg_turnaround:.0f}h) with low historical queue times"
    elif avg_turnaround <= 72:
        congestion_score = 40.0
        c_desc = f"Moderate turnaround (~{avg_turnaround:.0f}h) with normal berthing delays"
    elif avg_turnaround <= 96:
        congestion_score = 65.0
        c_desc = f"Elevated queue times (~{avg_turnaround:.0f}h) at mechanized berths"
    else:
        congestion_score = 90.0
        c_desc = f"High congestion / tidal delays (~{avg_turnaround:.0f}h turnaround)"

    # ── 2. Cyclone / Weather Seasonality Risk (Weight: 25%) ──────────────────
    # East Coast India / Bay of Bengal cyclonic patterns:
    #   Oct - Nov : Post-monsoon peak cyclone season (highest risk)
    #   May       : Pre-monsoon transition cyclones (high risk)
    #   Dec       : Late post-monsoon cyclonic swell (moderate-high risk)
    #   Jun - Sep : SW monsoon rough swell (moderate sea state)
    #   Jan - Mar : Northeast fair weather window (lowest risk)
    if isinstance(arrival_date, str):
        try:
            arr_dt = datetime.fromisoformat(arrival_date.replace("Z", "+00:00"))
        except Exception:
            arr_dt = datetime.now()
    else:
        arr_dt = arrival_date

    month = arr_dt.month
    if month == 10:
        weather_score = 85.0
        w_desc = "October peak post-monsoon cyclone season in Bay of Bengal (high risk of berth shutdowns)"
    elif month == 11:
        weather_score = 75.0
        w_desc = "November post-monsoon cyclonic depression window in Bay of Bengal"
    elif month == 5:
        weather_score = 65.0
        w_desc = "May pre-monsoon severe cyclonic storm window in Bay of Bengal"
    elif month == 12:
        weather_score = 55.0
        w_desc = "December late post-monsoon cyclonic swell in Bay of Bengal"
    elif month == 4:
        weather_score = 45.0
        w_desc = "April pre-monsoon transitional weather window in Bay of Bengal"
    elif month in [6, 7, 8, 9]:
        weather_score = 40.0
        w_desc = "Southwest monsoon period — heavy swells and moderate rain delays"
    else:
        weather_score = 15.0
        w_desc = "Favourable fair-weather winter navigational window in Bay of Bengal"

    # ── 3. Market Volatility / Forecast Band Width Risk (Weight: 25%) ────────
    # Ratio: (P90 - P10) / P50
    if forecast_p50 > 0:
        spread_ratio = max(0.0, (forecast_p90 - forecast_p10) / forecast_p50)
    else:
        spread_ratio = 0.20

    # Scale: spread ≤ 0.10 → 15, spread = 0.25 → 50, spread ≥ 0.40 → 90
    volatility_score = float(np.clip((spread_ratio / 0.35) * 70.0 + 10.0, 10.0, 95.0))
    spread_pct = spread_ratio * 100.0
    v_desc = f"P90–P10 forecast spread of {spread_pct:.1f}% indicates {'high' if spread_pct > 25 else 'moderate'} freight rate volatility"

    # ── 4. Draft Margin & Physical Fit Risk (Weight: 20%) ────────────────────
    port_draft = dest_port.get("max_draft_m", 14.5)
    vessel_draft = vessel_class.get("typical_draft_m", 14.0)
    draft_margin = port_draft - vessel_draft

    dwt_min = vessel_class.get("dwt_min", 40000)
    dwt_max = vessel_class.get("dwt_max", 65000)

    if draft_margin < 0:
        # Infeasible / unsafe draft
        draft_score = 100.0
        d_desc = f"Draft violation: vessel draft ({vessel_draft}m) exceeds port maximum ({port_draft}m) by {abs(draft_margin):.1f}m"
    elif draft_margin < 0.6:
        draft_score = 75.0
        d_desc = f"Tight under-keel clearance margin ({draft_margin:.1f}m < 0.6m) — vulnerable to silting and low-tide windows"
    elif draft_margin <= 1.5:
        draft_score = 35.0
        d_desc = f"Comfortable draft clearance margin ({draft_margin:.1f}m) within port operating tolerances"
    else:
        draft_score = 15.0
        d_desc = f"Ample draft clearance margin ({draft_margin:.1f}m) allowing all-tide navigation"

    # Parcel utilization adjustment
    if cargo_tonnes > dwt_max:
        draft_score = min(100.0, draft_score + 25.0)
        d_desc += f"; parcel ({cargo_tonnes:,.0f}t) exceeds single-voyage DWT ({dwt_max:,.0f}t)"
    elif cargo_tonnes < dwt_min:
        draft_score = min(100.0, draft_score + 15.0)
        d_desc += f"; vessel underutilised for parcel ({cargo_tonnes:,.0f}t < {dwt_min:,.0f}t min DWT)"

    # ── Composite weighted score ─────────────────────────────────────────────
    drivers = [
        {
            "name": "Port Congestion",
            "score": round(congestion_score, 1),
            "weight": 0.30,
            "contribution": round(congestion_score * 0.30, 1),
            "description": c_desc,
        },
        {
            "name": "Cyclone & Weather Seasonality",
            "score": round(weather_score, 1),
            "weight": 0.25,
            "contribution": round(weather_score * 0.25, 1),
            "description": w_desc,
        },
        {
            "name": "Freight Market Volatility",
            "score": round(volatility_score, 1),
            "weight": 0.25,
            "contribution": round(volatility_score * 0.25, 1),
            "description": v_desc,
        },
        {
            "name": "Draft & Physical Fit",
            "score": round(draft_score, 1),
            "weight": 0.20,
            "contribution": round(draft_score * 0.20, 1),
            "description": d_desc,
        },
    ]

    total_score = int(round(sum(d["contribution"] for d in drivers)))
    total_score = max(0, min(100, total_score))

    if total_score < 40:
        band = "low"
    elif total_score <= 65:
        band = "medium"
    else:
        band = "high"

    return {
        "score": total_score,
        "band": band,
        "drivers": drivers,
    }
