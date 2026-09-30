"""Feasibility engine — checks whether a given vessel class can serve a
cargo-size + origin/destination-port combination.

Return shape (superset of the original {"feasible", "reasons"} contract, so
callers that only read those two keys keep working):

    {
      "feasible":            bool,          # False if EITHER port rejects
      "reasons":             [str, ...],
      "dest_check":          {"port", "passed", "bottleneck"},
      "origin_check":        {"port", "passed", "bottleneck"} | None,
      "load_port_bottleneck": "draft"|"loa"|"beam"|None,
    }

`origin_check` is None (and no origin-side reasons are appended) when the
caller doesn't pass ``load_port`` or when the load-port record lacks the new
``max_draft_m`` field — this preserves backward-compat with older data files
and older callers.
"""

from __future__ import annotations

from typing import Any


def _check_physical(vessel: dict[str, Any], port: dict[str, Any], side: str) -> tuple[bool, list[str], str | None]:
    """Run draft / LOA / beam checks for ``vessel`` at ``port``.

    ``side`` is a human label ("Loading" or "Discharge") used to prefix each
    reason so the two ports remain distinguishable in the combined list.
    Returns (ok, reasons, first_bottleneck).
    """
    reasons: list[str] = []
    ok = True
    bottleneck: str | None = None
    port_name = port.get("name", port.get("id", "port"))

    if vessel["typical_draft_m"] > port["max_draft_m"]:
        ok = False
        if bottleneck is None:
            bottleneck = "draft"
        reasons.append(
            f"[{side} @ {port_name}] Draft too deep: {vessel['class']} typical draft "
            f"{vessel['typical_draft_m']} m > port max {port['max_draft_m']} m"
        )
    else:
        reasons.append(
            f"[{side} @ {port_name}] Draft OK: {vessel['typical_draft_m']} m ≤ "
            f"{port['max_draft_m']} m"
        )

    if vessel["typical_loa_m"] > port["max_loa_m"]:
        ok = False
        if bottleneck is None:
            bottleneck = "loa"
        reasons.append(
            f"[{side} @ {port_name}] LOA too long: {vessel['class']} typical LOA "
            f"{vessel['typical_loa_m']} m > port max {port['max_loa_m']} m"
        )
    else:
        reasons.append(
            f"[{side} @ {port_name}] LOA OK: {vessel['typical_loa_m']} m ≤ "
            f"{port['max_loa_m']} m"
        )

    if vessel["typical_beam_m"] > port["max_beam_m"]:
        ok = False
        if bottleneck is None:
            bottleneck = "beam"
        reasons.append(
            f"[{side} @ {port_name}] Beam too wide: {vessel['class']} typical beam "
            f"{vessel['typical_beam_m']} m > port max {port['max_beam_m']} m"
        )
    else:
        reasons.append(
            f"[{side} @ {port_name}] Beam OK: {vessel['typical_beam_m']} m ≤ "
            f"{port['max_beam_m']} m"
        )

    return ok, reasons, bottleneck


def feasible(
    cargo_tonnes: float,
    dest_port: dict[str, Any],
    vessel: dict[str, Any],
    load_port: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate voyage feasibility at both the loading and discharge ports.

    Parameters
    ----------
    cargo_tonnes : float
        Desired cargo quantity in metric tonnes.
    dest_port : dict
        Port record (from ports.json) for the discharge port.
    vessel : dict
        Vessel-class record (from vessel_classes.json).
    load_port : dict, optional
        Port record (from load_ports.json) for the loading port. When
        omitted, or when the record lacks the ``max_draft_m`` field
        (backward-compat with older seed data), the origin check is skipped
        silently and the return matches the pre-load-port behaviour.
    """
    # ── Discharge-port physical checks ────────────────────────────────────
    dest_ok, dest_reasons, dest_bottleneck = _check_physical(vessel, dest_port, "Discharge")
    reasons: list[str] = list(dest_reasons)

    dest_check = {
        "port": dest_port.get("name", dest_port.get("id")),
        "passed": dest_ok,
        "bottleneck": dest_bottleneck,
    }

    # ── Optional loading-port physical checks (additive) ──────────────────
    origin_check: dict[str, Any] | None = None
    load_ok = True
    load_bottleneck: str | None = None
    if load_port is not None and "max_draft_m" in load_port:
        load_ok, load_reasons, load_bottleneck = _check_physical(vessel, load_port, "Loading")
        reasons.extend(load_reasons)
        origin_check = {
            "port": load_port.get("name", load_port.get("id")),
            "passed": load_ok,
            "bottleneck": load_bottleneck,
        }

    # ── Cargo capacity check (port-agnostic, kept as-is) ──────────────────
    dwt_min = vessel["dwt_min"]
    dwt_max = vessel["dwt_max"]

    if cargo_tonnes > dwt_max:
        # Still "feasible" in principle but needs multiple voyages
        voyages = -(-int(cargo_tonnes) // dwt_max)  # ceiling division
        reasons.append(
            f"Insufficient single-voyage capacity: {cargo_tonnes:,.0f} t > "
            f"{dwt_max:,} t DWT — needs ≥ {voyages} voyages"
        )
        # Don't gate on this: the cargo CAN move, just not in one voyage
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

    return {
        "feasible": dest_ok and load_ok,
        "reasons": reasons,
        "dest_check": dest_check,
        "origin_check": origin_check,
        "load_port_bottleneck": load_bottleneck,
    }
