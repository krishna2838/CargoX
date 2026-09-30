"""Sanity tests for the multi-voyage contract planner.

Covers the three checks the task asks for:

1. A 6-month contract of 300 kt at 75 kt parcels on Hay Point → Paradip
   produces exactly 4 voyages, with matching top-level contract metadata.
2. The contract's average landed cost is *different* from the spot benchmark
   (the planner is actually calling the forecast, not returning a constant).
3. Bad inputs (parcel larger than the contract volume) surface as HTTP 400
   from the router, not as a 500 traceback.

Run:  python -m pytest api/tests/test_multi_voyage.py
Or:   python api/tests/test_multi_voyage.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_API_ROOT = Path(__file__).resolve().parent.parent
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def _client() -> TestClient:
    return TestClient(app)


def test_six_month_contract_generates_four_voyages() -> None:
    """6 mo × 600 kt/yr at 75 kt = 300 kt / 75 kt = 4 voyages."""
    with _client() as c:
        r = c.post("/contract", json={
            "annual_tonnes": 600_000,
            "parcel_size":    75_000,
            "commodity":      "coking_coal",
            "load_port_id":   "hay_point",
            "dest_port_id":   "paradip",
            "contract_months": 6,
            "start_date":     "2026-11-01",
        })
    assert r.status_code == 200, r.text
    body = r.json()

    contract = body["contract"]
    assert contract["type"] == "6m"
    assert contract["start"] == "2026-11-01"
    assert contract["voyage_count"] == 4
    assert contract["total_tonnes"] == 300_000.0
    assert contract["parcel_size"] == 75_000
    assert contract["load_port"]["id"] == "hay_point"
    assert contract["dest_port"]["id"] == "paradip"

    schedule = body["schedule"]
    assert len(schedule) == 4
    # ETAs must strictly increase and start on the contract start date.
    etas = [v["eta_load"] for v in schedule]
    assert etas[0] == "2026-11-01"
    assert etas == sorted(etas)
    # Every voyage carries the required scoring fields.
    for v in schedule:
        for k in ("voyage_num", "vessel_class", "landed_cost_inr_per_t", "risk_score"):
            assert k in v, f"voyage missing field {k}"


def test_contract_cost_diverges_from_spot() -> None:
    """The per-voyage forecast is actually being applied, not stubbed as spot."""
    with _client() as c:
        r = c.post("/contract", json={
            "annual_tonnes": 600_000,
            "parcel_size":    75_000,
            "commodity":      "coking_coal",
            "load_port_id":   "hay_point",
            "dest_port_id":   "paradip",
            "contract_months": 6,
            "start_date":     "2026-11-01",
        })
    assert r.status_code == 200, r.text
    agg = r.json()["aggregate"]
    # Contract avg and spot benchmark should differ — even by fractions of
    # a rupee — because the forecast bends per voyage.
    assert agg["avg_landed_cost_per_t_inr"] != agg["spot_comparison_inr_per_t"], (
        "Contract avg equals spot benchmark exactly — forecast likely being ignored."
    )
    # Totals should be internally consistent.
    expected_total = agg["avg_landed_cost_per_t_inr"] * 75_000 * 4
    assert abs(agg["total_landed_cost_inr"] - expected_total) < 1.0, (
        "total_landed_cost_inr disagrees with avg × parcels × voyages"
    )


def test_parcel_bigger_than_contract_returns_400() -> None:
    """A parcel that dwarfs the whole contract must 400, not 500."""
    with _client() as c:
        r = c.post("/contract", json={
            "annual_tonnes": 100_000,   # 6-mo contract = 50k total
            "parcel_size":    75_000,   # bigger than the whole contract
            "commodity":      "coking_coal",
            "load_port_id":   "hay_point",
            "dest_port_id":   "paradip",
            "contract_months": 6,
            "start_date":     "2026-11-01",
        })
    assert r.status_code == 400, r.text
    assert "parcel_size" in r.json()["detail"], r.json()


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"OK  {name}")
    print("all multi-voyage tests passed")
