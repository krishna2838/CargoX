"""Feasibility engine — checks whether a given vessel class can serve a
cargo-size + destination-port combination.

Returns a dict:
  { "feasible": bool, "reasons": [str, ...] }

Reasons explain each pass/fail check so the UI can surface WHY.
"""

from __future__ import annotations

from typing import Any


def feasible(
    cargo_tonnes: float,
    dest_port: dict[str, Any],
    vessel: dict[str, Any],
) -> dict[str, Any]:
    """Evaluate voyage feasibility.

    Parameters
    ----------
    cargo_tonnes : float
        Desired cargo quantity in metric tonnes.
    dest_port : dict
        Port record (from ports.json) for the discharge port.
    vessel : dict
        Vessel-class record (from vessel_classes.json).

    Returns
    -------
    dict  {"feasible": bool, "reasons": list[str]}
    """
    reasons: list[str] = []
    ok = True

    # ── Draft check ──────────────────────────────────────────────────────
    if vessel["typical_draft_m"] > dest_port["max_draft_m"]:
        ok = False
        reasons.append(
            f"Draft too deep: {vessel['class']} typical draft "
            f"{vessel['typical_draft_m']} m > port max {dest_port['max_draft_m']} m"
        )
    else:
        reasons.append(
            f"Draft OK: {vessel['typical_draft_m']} m ≤ "
            f"{dest_port['max_draft_m']} m"
        )

    # ── LOA check ────────────────────────────────────────────────────────
    if vessel["typical_loa_m"] > dest_port["max_loa_m"]:
        ok = False
        reasons.append(
            f"LOA too long: {vessel['class']} typical LOA "
            f"{vessel['typical_loa_m']} m > port max {dest_port['max_loa_m']} m"
        )
    else:
        reasons.append(
            f"LOA OK: {vessel['typical_loa_m']} m ≤ "
            f"{dest_port['max_loa_m']} m"
        )

    # ── Beam check ───────────────────────────────────────────────────────
    if vessel["typical_beam_m"] > dest_port["max_beam_m"]:
        ok = False
        reasons.append(
            f"Beam too wide: {vessel['class']} typical beam "
            f"{vessel['typical_beam_m']} m > port max {dest_port['max_beam_m']} m"
        )
    else:
        reasons.append(
            f"Beam OK: {vessel['typical_beam_m']} m ≤ "
            f"{dest_port['max_beam_m']} m"
        )

    # ── Cargo capacity check ─────────────────────────────────────────────
    dwt_min = vessel["dwt_min"]
    dwt_max = vessel["dwt_max"]

    if cargo_tonnes > dwt_max:
        # Still "feasible" in principle but needs multiple voyages
        voyages = -(-int(cargo_tonnes) // dwt_max)  # ceiling division
        reasons.append(
            f"Insufficient single-voyage capacity: {cargo_tonnes:,.0f} t > "
            f"{dwt_max:,} t DWT — needs ≥ {voyages} voyages"
        )
        # Don't set ok=False: the cargo CAN move, just not in one voyage
    elif cargo_tonnes < dwt_min:
        reasons.append(
            f"Underutilised: {cargo_tonnes:,.0f} t < "
            f"{dwt_min:,} t DWT min — vessel oversized for this parcel"
        )
    else:
        utilisation = cargo_tonnes / dwt_max * 100
        reasons.append(
            f"Capacity OK: {cargo_tonnes:,.0f} t within "
            f"{dwt_min:,}–{dwt_max:,} t DWT range "
            f"({utilisation:.0f}% utilisation)"
        )

    return {"feasible": ok, "reasons": reasons}
