"""Sanity checks for the load-port aware feasibility engine.

These verify the three guarantees promised by the extended feasibility
contract:

1. A vessel whose draft exceeds the LOAD-port limit is rejected, even when
   the destination port could physically take it.
2. A vessel whose draft is within both port limits stays feasible.
3. Calling ``feasible()`` without ``load_port`` (or with a load-port record
   missing the new constraint fields) matches the pre-existing behaviour
   byte-for-byte, so older callers and older seed data still work.

Run with:  python -m pytest api/tests/test_load_port_feas.py
Or standalone:  python api/tests/test_load_port_feas.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow "python api/tests/test_load_port_feas.py" without pytest.
_API_ROOT = Path(__file__).resolve().parent.parent
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.engine.feasibility import feasible  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────

CAPESIZE = {
    "class": "Capesize",
    "typical_draft_m": 18.2,
    "typical_loa_m":   289.0,
    "typical_beam_m":  45.0,
    "dwt_min": 120_000,
    "dwt_max": 180_000,
}

PANAMAX = {
    "class": "Panamax",
    "typical_draft_m": 14.0,
    "typical_loa_m":   225.0,
    "typical_beam_m":  32.2,
    "dwt_min": 65_000,
    "dwt_max": 82_000,
}

# Deep discharge port that can take either vessel.
DEST_DEEP = {
    "id": "gangavaram",
    "name": "Gangavaram",
    "max_draft_m": 21.0,
    "max_loa_m":   330,
    "max_beam_m":  55,
}

# Shallow loading port — draft 15 m, so Capesize's 18.2 m draft violates.
LOAD_SHALLOW = {
    "id": "beira",
    "name": "Beira",
    "max_draft_m": 15.0,
    "max_loa_m":   290,
    "max_beam_m":  50,
}

# Legacy load-port record with none of the new constraint fields — the
# engine must treat this exactly like ``load_port=None`` (silent skip).
LOAD_LEGACY = {
    "id": "port_hedland",
    "name": "Port Hedland",
    "primary_cargo": ["iron_ore"],
}


# ── Tests ───────────────────────────────────────────────────────────────────

def test_capesize_rejected_by_shallow_load_port() -> None:
    """Capesize (18.2 m draft) must fail when loading port allows only 15 m."""
    result = feasible(75_000, DEST_DEEP, CAPESIZE, load_port=LOAD_SHALLOW)

    assert result["feasible"] is False, "Capesize should be infeasible when the load-port draft is 15 m"
    assert result["load_port_bottleneck"] == "draft"
    assert result["origin_check"] is not None
    assert result["origin_check"]["port"] == "Beira"
    assert result["origin_check"]["passed"] is False
    # dest-side must still pass — the failure is at the load port
    assert result["dest_check"]["passed"] is True
    # At least one reason must name the loading port
    assert any("Loading @ Beira" in r for r in result["reasons"])


def test_panamax_accepted_by_shallow_load_port() -> None:
    """Panamax (14.0 m draft) fits under a 15.0 m load-port limit."""
    result = feasible(75_000, DEST_DEEP, PANAMAX, load_port=LOAD_SHALLOW)

    assert result["feasible"] is True
    assert result["load_port_bottleneck"] is None
    assert result["origin_check"] is not None
    assert result["origin_check"]["passed"] is True


def test_backward_compat_no_load_port() -> None:
    """Omitting load_port must reproduce the pre-load-port behaviour.

    Same-input calls with/without a legacy record (no new fields) must return
    identical feasibility and identical reasons, and neither must include any
    origin-side reasons.
    """
    a = feasible(75_000, DEST_DEEP, CAPESIZE)
    b = feasible(75_000, DEST_DEEP, CAPESIZE, load_port=LOAD_LEGACY)

    assert a["feasible"] == b["feasible"] is True, "Deep discharge port takes Capesize; no load-port context to fail on"
    assert a["reasons"] == b["reasons"], "Legacy load-port record must be a silent no-op"
    assert a["origin_check"] is None
    assert b["origin_check"] is None
    assert a["load_port_bottleneck"] is None

    # The legacy path must not have tagged any reason with "Loading @".
    assert not any("Loading @" in r for r in a["reasons"])


# ── Standalone runner ───────────────────────────────────────────────────────

if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"OK  {name}")
    print("all load-port feasibility tests passed")
