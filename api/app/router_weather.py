"""FastAPI router for maritime weather and cyclone route risk.

Exposes:
  GET /weather/route?load={load}&dest={dest}
    Samples 4 critical sea-lane waypoints (Origin, Mid-Ocean, Bay of Bengal, Destination),
    queries Open-Meteo wind and marine wave-height forecasts, applies documented maritime
    thresholds and Bay of Bengal seasonal cyclone weights, and estimates voyage delay.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Query

from app.db import get_load_port_by_id, get_port_by_id

log = logging.getLogger(__name__)

router = APIRouter(prefix="/weather", tags=["weather"])

# Default coordinates for trade-lane waypoints if port coords unavailable
DEFAULT_ORIGIN = {"id": "hay_point", "name": "Hay Point (AU)", "lat": -21.275, "lng": 149.29}
DEFAULT_DEST = {"id": "paradip", "name": "Paradip (IN)", "lat": 20.264, "lng": 86.628}


async def _fetch_open_meteo_waypoint(
    client: httpx.AsyncClient,
    name: str,
    stage: str,
    lat: float,
    lng: float,
    is_bay_of_bengal: bool = False,
) -> dict[str, Any]:
    """Fetch live wind speed and wave height for a marine coordinate."""
    wind_kn: Optional[float] = None
    wave_m: Optional[float] = None
    is_live = False

    # Weather API for wind speed (knots)
    weather_url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat:.4f}&longitude={lng:.4f}&current=wind_speed_10m&wind_speed_unit=kn"
    )
    # Marine API for significant wave height (meters)
    marine_url = (
        f"https://marine-api.open-meteo.com/v1/marine"
        f"?latitude={lat:.4f}&longitude={lng:.4f}&current=wave_height"
    )

    try:
        w_res, m_res = await asyncio.gather(
            client.get(weather_url, timeout=3.0),
            client.get(marine_url, timeout=3.0),
            return_exceptions=True,
        )

        if not isinstance(w_res, Exception) and w_res.status_code == 200:
            w_data = w_res.json()
            if "current" in w_data and "wind_speed_10m" in w_data["current"]:
                wind_kn = float(w_data["current"]["wind_speed_10m"])
                is_live = True

        if not isinstance(m_res, Exception) and m_res.status_code == 200:
            m_data = m_res.json()
            if "current" in m_data and "wave_height" in m_data["current"]:
                val = m_data["current"]["wave_height"]
                if val is not None:
                    wave_m = float(val)
                    is_live = True
    except Exception as exc:
        log.warning(f"Error fetching Open-Meteo for {name}: {exc}")

    # Fallback to realistic seasonal marine baseline if API timed out or marine grid offline
    month = datetime.now().month
    if wind_kn is None:
        wind_kn = 24.0 if is_bay_of_bengal and month in [10, 11] else 16.5
    if wave_m is None:
        wave_m = 2.8 if is_bay_of_bengal and month in [10, 11] else 1.9

    # Threshold classification
    # Red: wave > 4.0m OR wind > 34 kn (Gale 8+) OR (BoB peak cyclone and wave > 3.0m)
    # Amber: wave > 2.5m OR wind > 22 kn (Strong breeze 6+) OR (BoB seasonal bump)
    # Green: calm to moderate sea state
    is_cyclone_season = is_bay_of_bengal and month in [10, 11, 12, 5]
    peak_cyclone_season = is_bay_of_bengal and month in [10, 11]

    if wave_m > 4.0 or wind_kn > 34.0 or (peak_cyclone_season and wave_m > 3.0):
        risk = "red"
        status_label = "Severe Sea State / Cyclone Hazard"
    elif wave_m > 2.5 or wind_kn > 22.0 or is_cyclone_season:
        risk = "amber"
        status_label = "Moderate Swell / Seasonal Caution" if is_cyclone_season else "Moderate Sea State"
    else:
        risk = "green"
        status_label = "Favourable Sea State"

    notes = []
    if is_cyclone_season:
        notes.append("Seasonal Bay of Bengal cyclone depression window active (Oct-Dec, May)")
    if wave_m > 3.0:
        notes.append(f"Heavy swell: wave height {wave_m:.1f}m > 3.0m operating limit")
    if wind_kn > 25.0:
        notes.append(f"Strong winds: {wind_kn:.1f} kn")

    return {
        "stage": stage,
        "name": name,
        "latitude": round(lat, 3),
        "longitude": round(lng, 3),
        "wind_kn": round(wind_kn, 1),
        "wave_m": round(wave_m, 2),
        "risk": risk,
        "status_label": status_label,
        "cyclone_factor_applied": is_cyclone_season,
        "is_live": is_live,
        "notes": notes,
    }


@router.get("/route")
async def get_route_weather(
    load: str = Query("hay_point", description="Load port ID"),
    dest: str = Query("paradip", description="Destination port ID"),
):
    """Return weather and cyclone route risk across 4 waypoints along the sea lane."""
    load_port = get_load_port_by_id(load) or DEFAULT_ORIGIN
    dest_port = get_port_by_id(dest) or DEFAULT_DEST

    load_lat = float(load_port.get("lat", DEFAULT_ORIGIN["lat"]))
    load_lng = float(load_port.get("lng", DEFAULT_ORIGIN["lng"]))
    dest_lat = float(dest_port.get("lat", DEFAULT_DEST["lat"]))
    dest_lng = float(dest_port.get("lng", DEFAULT_DEST["lng"]))

    # Waypoint 1: Origin / Loading port
    wp1 = (load_port.get("name", "Origin Port"), "Origin", load_lat, load_lng, False)

    # Waypoint 2: Mid-ocean corridor (Equatorial Indian Ocean / Sunda Strait)
    mid_lat = (load_lat + dest_lat) / 2.0
    mid_lng = (load_lng + dest_lng) / 2.0
    # Adjust realistic sea-lane waypoint south of Sumatra if route from Australia
    if load_lng > 110:
        mid_lat = -6.5
        mid_lng = 98.5
    wp2 = ("Equatorial Indian Ocean", "Mid-Ocean", mid_lat, mid_lng, False)

    # Waypoint 3: Central Bay of Bengal
    wp3 = ("Bay of Bengal Central", "Bay of Bengal", 13.0, 86.5, True)

    # Waypoint 4: Destination discharge roadstead
    wp4 = (dest_port.get("name", "Destination Port"), "Destination", dest_lat, dest_lng, True)

    waypoints_def = [wp1, wp2, wp3, wp4]

    async with httpx.AsyncClient() as client:
        tasks = [
            _fetch_open_meteo_waypoint(client, name, stage, lat, lng, is_bob)
            for (name, stage, lat, lng, is_bob) in waypoints_def
        ]
        results = await asyncio.gather(*tasks)

    # Calculate overall route delay range based on risk dots
    red_count = sum(1 for r in results if r["risk"] == "red")
    amber_count = sum(1 for r in results if r["risk"] == "amber")

    if red_count >= 2:
        delay_range = "36 – 72h"
        delay_summary = "Severe sea state & cyclone anchorage hold expected"
        overall_risk = "red"
    elif red_count == 1 or amber_count >= 2:
        delay_range = "18 – 36h"
        delay_summary = "Rough swell & navigational speed reduction"
        overall_risk = "amber"
    elif amber_count == 1:
        delay_range = "6 – 18h"
        delay_summary = "Moderate seasonal swell slowdown"
        overall_risk = "amber"
    else:
        delay_range = "0 – 6h"
        delay_summary = "Favourable conditions & minimal voyage delay"
        overall_risk = "green"

    return {
        "load_port_id": load,
        "dest_port_id": dest,
        "overall_risk": overall_risk,
        "estimated_delay_range": delay_range,
        "estimated_delay_summary": delay_summary,
        "waypoints": results,
        "timestamp": datetime.now().isoformat(),
    }
