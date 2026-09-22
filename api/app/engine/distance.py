"""Distance engine — sea-route distance (NM) between two ports.

Uses the `searoute` library for realistic waypoint-based routing through
major sea lanes (Suez, Malacca, Cape of Good Hope, etc.).

Computed distances are cached in the DuckDB `distances` table so we don't
re-compute the same pair on every request.
"""

from __future__ import annotations

import logging
from typing import Any

import searoute as sr

log = logging.getLogger(__name__)

# Conversion: 1 km ≈ 0.539957 NM
KM_TO_NM = 0.539957


def _compute_distance_nm(
    origin_lng: float,
    origin_lat: float,
    dest_lng: float,
    dest_lat: float,
) -> float:
    """Compute sea-route distance in nautical miles between two points.

    searoute.searoute() returns a GeoJSON Feature whose geometry is a
    LineString and whose properties include ``length`` in **kilometres**.
    """
    origin = [origin_lng, origin_lat]  # searoute expects [lng, lat]
    destination = [dest_lng, dest_lat]

    route = sr.searoute(origin, destination, units="km")
    distance_km = route["properties"]["length"]
    return round(distance_km * KM_TO_NM, 1)


def get_distance(
    load_port: dict[str, Any],
    dest_port: dict[str, Any],
    db_conn: Any | None = None,
) -> float:
    """Return sea-route distance (NM) between *load_port* and *dest_port*.

    If *db_conn* (a DuckDB connection) is provided, the result is cached in
    the ``distances`` table.  On subsequent calls, the cached value is
    returned directly.
    """
    load_id = load_port["id"]
    dest_id = dest_port["id"]

    # ── Try cache first ──────────────────────────────────────────────────
    if db_conn is not None:
        try:
            cached = db_conn.execute(
                "SELECT distance_nm FROM distances "
                "WHERE load_port_id = ? AND dest_port_id = ?",
                [load_id, dest_id],
            ).fetchone()
            if cached:
                return cached[0]
        except Exception:
            pass  # table may not exist yet on first call

    # ── Compute ──────────────────────────────────────────────────────────
    distance_nm = _compute_distance_nm(
        load_port["lng"], load_port["lat"],
        dest_port["lng"], dest_port["lat"],
    )
    log.info(
        "Computed distance %s → %s = %.1f NM", load_id, dest_id, distance_nm,
    )

    # ── Cache ────────────────────────────────────────────────────────────
    if db_conn is not None:
        try:
            db_conn.execute(
                "INSERT OR REPLACE INTO distances "
                "(load_port_id, dest_port_id, distance_nm) VALUES (?, ?, ?)",
                [load_id, dest_id, distance_nm],
            )
        except Exception as exc:
            log.warning("Could not cache distance: %s", exc)

    return distance_nm
