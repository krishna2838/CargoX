"""CargoX AIS Ingestion Worker.

Connects to AISStream (wss://stream.aisstream.io/v0/stream) and populates
the ``live_vessels`` table in the shared SQLite database.

Run:
    cd api
    python -m worker.ais_worker

The API process reads from the same SQLite DB file; they are fully decoupled
and run concurrently using SQLite WAL mode.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Try to import websockets
try:
    import websockets
    import websockets.exceptions
except ImportError:
    print("ERROR: 'websockets' not installed. Run: pip install websockets")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_ROOT_DIR = Path(__file__).resolve().parent.parent
_ENV_PATH = _ROOT_DIR / ".env"
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH)
load_dotenv()  # fallback / supplement

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
)
log = logging.getLogger("ais_worker")

WS_URL = "wss://stream.aisstream.io/v0/stream"
API_KEY = os.environ.get("AISSTREAM_API_KEY", "")

# SQLite vessels DB file — same path as the API uses
DB_PATH = os.environ.get(
    "CARGOX_VESSELS_DB_PATH",
    os.environ.get("CARGOX_DB_PATH", str(_ROOT_DIR / "cargox_vessels.db")),
)

# Flush interval (seconds) — how often the in-memory dict is written to DB
FLUSH_INTERVAL = 10

# Stale threshold — drop vessels not seen within this window
STALE_MINUTES = 30

# AISStream subscription message
SUBSCRIBE_MSG = {
    "APIKey": API_KEY,
    "BoundingBoxes": [
        # (a) Bay of Bengal / East Coast India
        [[5, 78], [23, 95]],
        # (b) NW Australia iron-ore loading zone (Pilbara)
        [[-25, 112], [-10, 130]],
        # (c) Newcastle / Hay Point AU east coast (coal)
        [[-35, 148], [-18, 155]],
    ],
    "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
}


# ---------------------------------------------------------------------------
# Vessel class inference from AIS dimensions
# ---------------------------------------------------------------------------

def infer_vessel_class(
    loa: float | None,
    beam: float | None,
    ship_type: int | None,
) -> str | None:
    """Map AIS dimensions → our vessel_classes.json class name.

    Only classifies cargo vessels (AIS type 70-79). Uses LOA as
    the primary discriminator — this is a rough heuristic, not exact.
    """
    # Only classify cargo-type vessels
    if ship_type is not None and not (70 <= ship_type <= 79):
        return None
    if not loa or loa < 100:
        return None

    if loa >= 260:
        return "Capesize"
    elif loa >= 215:
        # Kamsarmax: max-length Panamax variant (LOA ≤ 229 m)
        if 225 <= loa <= 235 and beam and beam <= 33:
            return "Kamsarmax"
        return "Panamax"
    elif loa >= 170:
        return "Supramax"
    elif loa >= 100:
        return "Handysize"
    return None


def _parse_eta(eta_obj: dict | None) -> str | None:
    """Parse AIS ETA (month/day/hour/minute, no year) into an ISO string.

    Infers the year: if the month/day is in the past, assumes next year.
    """
    if not eta_obj:
        return None
    month = eta_obj.get("Month", 0)
    day = eta_obj.get("Day", 0)
    hour = eta_obj.get("Hour", 24)
    minute = eta_obj.get("Minute", 60)

    if month == 0 or day == 0 or hour >= 24 or minute >= 60:
        return None

    now = datetime.now(timezone.utc)
    year = now.year
    try:
        eta_dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    except ValueError:
        return None

    # If ETA is >30 days in the past, assume next year
    if eta_dt < now - timedelta(days=30):
        try:
            eta_dt = eta_dt.replace(year=year + 1)
        except ValueError:
            return None

    return eta_dt.isoformat()


# ---------------------------------------------------------------------------
# AIS Worker
# ---------------------------------------------------------------------------

class AISWorker:
    """Manages AIS WebSocket connection, in-memory vessel dict, and DB flush."""

    def __init__(self) -> None:
        self.vessels: dict[int, dict[str, Any]] = {}  # MMSI → merged data
        self.db_conn: sqlite3.Connection | None = None
        self._msg_count = 0
        self._last_stats = time.monotonic()

    # ── Main entry ───────────────────────────────────────────────────────

    async def run(self) -> None:
        key = os.environ.get("AISSTREAM_API_KEY", API_KEY)
        if not key:
            log.warning(
                "AISSTREAM_API_KEY not set in environment — "
                "AIS worker will not start. The API can still run without it."
            )
            return

        SUBSCRIBE_MSG["APIKey"] = key

        self._connect_db()
        self._ensure_table()

        log.info("AIS worker starting (DB: %s)", DB_PATH)
        log.info(
            "Subscribing to %d bounding boxes, message types: %s",
            len(SUBSCRIBE_MSG["BoundingBoxes"]),
            SUBSCRIBE_MSG["FilterMessageTypes"],
        )

        # Run WebSocket listener and periodic flusher concurrently
        await asyncio.gather(
            self._ws_listen(),
            self._periodic_flush(),
        )

    # ── Database ─────────────────────────────────────────────────────────

    def _connect_db(self) -> None:
        log.info("Connecting to SQLite: %s", DB_PATH)
        self.db_conn = sqlite3.connect(DB_PATH, timeout=10.0)
        self.db_conn.execute("PRAGMA journal_mode=WAL;")
        self.db_conn.execute("PRAGMA busy_timeout=5000;")

    def _ensure_table(self) -> None:
        assert self.db_conn is not None
        self.db_conn.execute("""
            CREATE TABLE IF NOT EXISTS live_vessels (
                mmsi           INTEGER PRIMARY KEY,
                name           TEXT,
                imo            INTEGER,
                callsign       TEXT,
                ship_type      INTEGER,
                dim_a          INTEGER,
                dim_b          INTEGER,
                dim_c          INTEGER,
                dim_d          INTEGER,
                loa            REAL,
                beam           REAL,
                draft          REAL,
                destination    TEXT,
                eta            TEXT,
                latitude       REAL,
                longitude      REAL,
                speed          REAL,
                course         REAL,
                heading        REAL,
                nav_status     INTEGER,
                inferred_class TEXT,
                last_seen      TEXT
            )
        """)
        self.db_conn.execute("CREATE INDEX IF NOT EXISTS idx_vessels_lat_lng ON live_vessels (latitude, longitude);")
        self.db_conn.execute("CREATE INDEX IF NOT EXISTS idx_vessels_inferred ON live_vessels (inferred_class);")
        self.db_conn.execute("CREATE INDEX IF NOT EXISTS idx_vessels_last_seen ON live_vessels (last_seen);")
        self.db_conn.commit()
        log.info("live_vessels table ready.")

    # ── WebSocket ────────────────────────────────────────────────────────

    async def _ws_listen(self) -> None:
        """Connect to AISStream with auto-reconnect + exponential backoff."""
        backoff = 1

        while True:
            try:
                async with websockets.connect(WS_URL) as ws:
                    log.info("Connected to AISStream")
                    await ws.send(json.dumps(SUBSCRIBE_MSG))
                    backoff = 1  # reset on success

                    async for raw_msg in ws:
                        try:
                            data = json.loads(raw_msg)
                            self._handle_message(data)
                        except json.JSONDecodeError:
                            log.warning("Malformed JSON from AISStream")
                        except Exception:
                            log.exception("Error handling AIS message")

            except websockets.exceptions.ConnectionClosed as e:
                log.warning("WebSocket closed: %s — reconnecting in %ds", e, backoff)
            except OSError as e:
                log.warning("Connection error: %s — reconnecting in %ds", e, backoff)
            except Exception:
                log.exception("Unexpected error — reconnecting in %ds", backoff)

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    # ── Message handling ─────────────────────────────────────────────────

    def _handle_message(self, data: dict) -> None:
        msg_type = data.get("MessageType")
        meta = data.get("MetaData", {})
        mmsi = meta.get("MMSI")
        if not mmsi:
            return

        self._msg_count += 1

        if mmsi not in self.vessels:
            self.vessels[mmsi] = {"mmsi": mmsi}

        vessel = self.vessels[mmsi]
        vessel["last_seen"] = datetime.now(timezone.utc).isoformat()
        name = (meta.get("ShipName") or "").strip()
        if name:
            vessel["name"] = name

        # MetaData can provide position even on static messages
        meta_lat = meta.get("latitude")
        meta_lng = meta.get("longitude")
        if "latitude" not in vessel and meta_lat is not None and abs(meta_lat) <= 90:
            vessel["latitude"] = meta_lat
        if "longitude" not in vessel and meta_lng is not None and abs(meta_lng) <= 180:
            vessel["longitude"] = meta_lng

        if msg_type == "PositionReport":
            pos = data.get("Message", {}).get("PositionReport", {})
            lat = pos.get("Latitude")
            lng = pos.get("Longitude")
            # AIS uses 91/181 for "not available"
            if lat is not None and abs(lat) <= 90:
                vessel["latitude"] = lat
            if lng is not None and abs(lng) <= 180:
                vessel["longitude"] = lng
            vessel["speed"] = pos.get("Sog")
            vessel["course"] = pos.get("Cog")
            vessel["heading"] = pos.get("TrueHeading")
            vessel["nav_status"] = pos.get("NavigationalStatus")

        elif msg_type == "ShipStaticData":
            static = data.get("Message", {}).get("ShipStaticData", {})
            imo = static.get("ImoNumber") or static.get("Imo")
            if imo:
                vessel["imo"] = imo
            callsign = (static.get("CallSign") or "").strip()
            if callsign:
                vessel["callsign"] = callsign
            ship_type = static.get("Type")
            if ship_type:
                vessel["ship_type"] = ship_type

            # Dimensions
            dim = static.get("Dimension", {})
            a = dim.get("A", 0)
            b = dim.get("B", 0)
            c = dim.get("C", 0)
            d = dim.get("D", 0)
            if a + b > 0:
                vessel["dim_a"] = a
                vessel["dim_b"] = b
                vessel["loa"] = float(a + b)
            if c + d > 0:
                vessel["dim_c"] = c
                vessel["dim_d"] = d
                vessel["beam"] = float(c + d)

            draft = static.get("MaximumStaticDraught")
            if draft and draft > 0:
                vessel["draft"] = draft

            dest = (static.get("Destination") or "").strip()
            if dest:
                vessel["destination"] = dest

            eta = _parse_eta(static.get("Eta"))
            if eta:
                vessel["eta"] = eta

            # Infer vessel class from dimensions
            inferred = infer_vessel_class(
                vessel.get("loa"),
                vessel.get("beam"),
                vessel.get("ship_type"),
            )
            if inferred:
                vessel["inferred_class"] = inferred

    # ── Periodic flush & prune ───────────────────────────────────────────

    async def _periodic_flush(self) -> None:
        """Every FLUSH_INTERVAL seconds: upsert to DB and prune stale."""
        while True:
            await asyncio.sleep(FLUSH_INTERVAL)
            try:
                self._flush_to_db()
                self._prune_stale()
                self._log_stats()
            except Exception:
                log.exception("Error during flush cycle")

    def _flush_to_db(self) -> None:
        """Upsert the current in-memory vessel snapshot to SQLite."""
        if not self.vessels or not self.db_conn:
            return

        columns = [
            "mmsi", "name", "imo", "callsign", "ship_type",
            "dim_a", "dim_b", "dim_c", "dim_d", "loa", "beam", "draft",
            "destination", "eta", "latitude", "longitude",
            "speed", "course", "heading", "nav_status",
            "inferred_class", "last_seen",
        ]

        rows = []
        for v in self.vessels.values():
            row = [v.get(c) for c in columns]
            rows.append(row)

        if not rows:
            return

        placeholders = ", ".join(["?"] * len(columns))
        col_names = ", ".join(columns)
        update_set = ", ".join(
            f"{c} = excluded.{c}" for c in columns if c != "mmsi"
        )

        try:
            self.db_conn.executemany(
                f"INSERT INTO live_vessels ({col_names}) VALUES ({placeholders}) "
                f"ON CONFLICT (mmsi) DO UPDATE SET {update_set}",
                rows,
            )
            self.db_conn.commit()
            log.debug("Flushed %d vessels to DB", len(rows))
        except Exception:
            log.exception("Failed to flush vessels to DB")

    def _prune_stale(self) -> None:
        """Remove vessels not seen within STALE_MINUTES from memory and DB."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_MINUTES)
        cutoff_str = cutoff.isoformat()

        # Prune in-memory
        stale_mmsis = [
            mmsi for mmsi, v in self.vessels.items()
            if v.get("last_seen", "") < cutoff_str
        ]
        for mmsi in stale_mmsis:
            del self.vessels[mmsi]

        # Prune DB
        if self.db_conn and stale_mmsis:
            try:
                self.db_conn.execute(
                    "DELETE FROM live_vessels WHERE last_seen < ?",
                    [cutoff_str],
                )
                self.db_conn.commit()
            except Exception:
                log.exception("Failed to prune stale vessels from DB")

        if stale_mmsis:
            log.info("Pruned %d stale vessels (not seen in %d min)",
                     len(stale_mmsis), STALE_MINUTES)

    def _log_stats(self) -> None:
        """Log throughput stats every 60 seconds."""
        now = time.monotonic()
        if now - self._last_stats >= 60:
            elapsed = now - self._last_stats
            rate = self._msg_count / elapsed if elapsed > 0 else 0
            log.info(
                "Stats: %d vessels tracked, %d messages (%.1f msg/s)",
                len(self.vessels), self._msg_count, rate,
            )
            self._msg_count = 0
            self._last_stats = now


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    worker = AISWorker()
    try:
        asyncio.run(worker.run())
    except KeyboardInterrupt:
        log.info("AIS worker stopped by user.")


if __name__ == "__main__":
    main()
