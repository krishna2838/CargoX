"""Database layer — DuckDB for reference & market data, SQLite for live vessels.

On startup, loads:
  - Reference JSON (ports, load_ports, vessel_classes)
  - Market CSVs (bdi_history, pinksheet, usdinr) from the data/ directory

Live vessels:
  - Stored in a file-based SQLite database with WAL (Write-Ahead Logging) enabled.
  - This allows the AIS worker process and the API server to read and write
    concurrently without any file locking contention or blocks.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_APP_DIR = Path(__file__).resolve().parent            # api/app/
_REF_DIR = _APP_DIR / "data" / "reference"            # api/app/data/reference/

_default_data_dir = _APP_DIR.parent.parent / "data"   # <root>/data/
if not _default_data_dir.exists() and (_APP_DIR.parent / "data").exists():
    _default_data_dir = _APP_DIR.parent / "data"

_DATA_DIR = Path(os.environ.get("CARGOX_DATA_DIR", str(_default_data_dir)))

# SQLite database for live AIS vessels — shared between API and AIS worker
VESSELS_DB_PATH = os.environ.get(
    "CARGOX_VESSELS_DB_PATH",
    str(_APP_DIR.parent / "cargox_vessels.db"),
)

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------
_conn: duckdb.DuckDBPyConnection | None = None
_ports: list[dict] = []
_load_ports: list[dict] = []
_vessel_classes: list[dict] = []


def get_conn() -> duckdb.DuckDBPyConnection:
    """Return the shared DuckDB connection (must call ``init_db`` first)."""
    assert _conn is not None, "Database not initialised — call init_db()"
    return _conn


def get_db_path() -> str:
    """Return the resolved vessels database path."""
    return VESSELS_DB_PATH


def get_ports() -> list[dict]:
    return _ports


def get_load_ports() -> list[dict]:
    return _load_ports


def get_vessel_classes() -> list[dict]:
    return _vessel_classes


def get_port_by_id(port_id: str) -> dict | None:
    """Lookup a destination port by ID."""
    for p in _ports:
        if p["id"] == port_id:
            return p
    return None


def get_load_port_by_id(port_id: str) -> dict | None:
    """Lookup a loading port by ID."""
    for p in _load_ports:
        if p["id"] == port_id:
            return p
    return None


def get_vessel_class_by_name(name: str) -> dict | None:
    """Lookup a vessel class by name (case-insensitive)."""
    name_lower = name.lower()
    for v in _vessel_classes:
        if v["class"].lower() == name_lower:
            return v
    return None


# ---------------------------------------------------------------------------
# SQLite helper for live vessels
# ---------------------------------------------------------------------------

def _get_vessels_conn() -> sqlite3.Connection:
    """Open a connection to the vessels SQLite DB with WAL mode."""
    conn = sqlite3.connect(VESSELS_DB_PATH, timeout=10.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


def _ensure_vessels_table() -> None:
    """Ensure the live_vessels table exists in SQLite with is_seeded flag."""
    with _get_vessels_conn() as conn:
        conn.execute("""
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
                last_seen      TEXT,
                is_seeded      INTEGER DEFAULT 0
            )
        """)
        # Ensure column exists for existing tables
        try:
            conn.execute("ALTER TABLE live_vessels ADD COLUMN is_seeded INTEGER DEFAULT 0;")
        except sqlite3.OperationalError:
            pass  # Already exists

        conn.execute("CREATE INDEX IF NOT EXISTS idx_vessels_lat_lng ON live_vessels (latitude, longitude);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vessels_inferred ON live_vessels (inferred_class);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vessels_last_seen ON live_vessels (last_seen);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vessels_is_seeded ON live_vessels (is_seeded);")


def is_demo_mode_enabled() -> bool:
    """Return True if DEMO_MODE is active (defaults to True for resilient judging)."""
    return os.getenv("DEMO_MODE", "true").lower() in ("1", "true", "yes")


def has_live_ais_vessels() -> bool:
    """Return True only if live_vessels table contains real (non-seeded) vessels."""
    try:
        with _get_vessels_conn() as conn:
            row = conn.execute("SELECT COUNT(*) FROM live_vessels WHERE is_seeded = 0").fetchone()
            return (row[0] > 0) if row else False
    except Exception:
        return False


def seed_demo_fleet_if_needed() -> None:
    """If DEMO_MODE is active and no real AIS vessels exist, populate seeded realistic fleet."""
    if not is_demo_mode_enabled():
        return
    if has_live_ais_vessels():
        return

    fleet_file = _DATA_DIR / "demo_fleet.json"
    if not fleet_file.exists():
        log.warning("Demo fleet file not found at %s", fleet_file)
        return

    try:
        with open(fleet_file, "r") as f:
            vessels = json.load(f)

        with _get_vessels_conn() as conn:
            seeded_count = conn.execute("SELECT COUNT(*) FROM live_vessels WHERE is_seeded = 1").fetchone()[0]
            if seeded_count >= len(vessels):
                return

            for v in vessels:
                conn.execute("""
                    INSERT OR REPLACE INTO live_vessels (
                        mmsi, name, imo, callsign, ship_type,
                        dim_a, dim_b, dim_c, dim_d, loa, beam, draft,
                        destination, eta, latitude, longitude, speed,
                        course, heading, nav_status, inferred_class,
                        last_seen, is_seeded
                    ) VALUES (
                        ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, 1
                    )
                """, [
                    v.get("mmsi"), v.get("name"), v.get("imo"), v.get("callsign"), v.get("ship_type", 70),
                    v.get("dim_a", 0), v.get("dim_b", 0), v.get("dim_c", 0), v.get("dim_d", 0),
                    v.get("loa", 200.0), v.get("beam", 32.2), v.get("draft", 12.0),
                    v.get("destination", "PARADIP"), v.get("eta"), v.get("latitude"), v.get("longitude"),
                    v.get("speed", 12.0), v.get("course", 315.0), v.get("heading", 315),
                    v.get("nav_status", 0), v.get("inferred_class", "Supramax"),
                    v.get("last_seen", "2026-09-22T14:30:00Z")
                ])
            conn.commit()
            log.info("Loaded %d seeded demo vessels into SQLite (DEMO_MODE=true)", len(vessels))
    except Exception as exc:
        log.warning("seed_demo_fleet_if_needed failed: %s", exc)



# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------

def init_db() -> None:
    """Create DuckDB tables and load all seed data."""
    global _conn, _ports, _load_ports, _vessel_classes

    log.info("Initialising in-memory DuckDB for analytics …")
    _conn = duckdb.connect(":memory:")

    # ── Reference JSON ───────────────────────────────────────────────────
    _ports = _load_json(_REF_DIR / "ports.json")
    _load_ports = _load_json(_REF_DIR / "load_ports.json")
    _vessel_classes = _load_json(_REF_DIR / "vessel_classes.json")
    log.info(
        "Loaded %d dest ports, %d load ports, %d vessel classes",
        len(_ports), len(_load_ports), len(_vessel_classes),
    )

    # ── Market CSV tables ────────────────────────────────────────────────
    _load_csv_table("bdi_history", _DATA_DIR / "bdi_history.csv")
    _load_csv_table("pinksheet", _DATA_DIR / "pinksheet.csv")
    _load_csv_table("usdinr", _DATA_DIR / "usdinr.csv")

    # ── Distance cache table ─────────────────────────────────────────────
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS distances (
            load_port_id VARCHAR,
            dest_port_id VARCHAR,
            distance_nm DOUBLE,
            PRIMARY KEY (load_port_id, dest_port_id)
        )
    """)

    # ── Ensure live vessels storage is ready ─────────────────────────────
    _ensure_vessels_table()
    seed_demo_fleet_if_needed()

    log.info("Database ready.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> list[dict]:
    with open(path, "r") as f:
        return json.load(f)


def _load_csv_table(table_name: str, csv_path: Path) -> None:
    """Load a CSV into a DuckDB table. Tolerant of missing columns."""
    if not csv_path.exists():
        log.warning("CSV not found, skipping: %s", csv_path)
        return
    try:
        _conn.execute(f"DROP TABLE IF EXISTS {table_name}")
        _conn.execute(
            f"CREATE TABLE {table_name} AS "
            f"SELECT * FROM read_csv_auto('{csv_path}', header=true)"
        )
        count = _conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
        log.info("  Loaded %s: %d rows", table_name, count)
    except Exception as exc:
        log.error("Failed to load %s: %s", csv_path, exc)


# ---------------------------------------------------------------------------
# Query helpers — market data
# ---------------------------------------------------------------------------

def query_latest_bdi() -> dict[str, Any]:
    """Return the most recent row from bdi_history."""
    row = _conn.execute(
        "SELECT * FROM bdi_history ORDER BY date DESC LIMIT 1"
    ).fetchdf().to_dict(orient="records")
    return row[0] if row else {}


def query_latest_bdi_enriched() -> dict[str, Any]:
    """Return the most recent row from bdi_history along with 7d/30d deltas
    and fixed 30-point sparklines for BDI, BCI, BPI, BSI, and BHSI."""
    rows = _conn.execute(
        "SELECT * FROM bdi_history ORDER BY date DESC LIMIT 31"
    ).fetchdf().to_dict(orient="records")
    if not rows:
        return {}

    latest_row = dict(rows[0])
    if hasattr(latest_row.get("date"), "isoformat"):
        latest_row["date"] = latest_row["date"].isoformat()

    indices = ["BDI", "BCI", "BPI", "BSI", "BHSI"]
    metrics: dict[str, Any] = {}
    chronological = list(reversed(rows))

    for idx in indices:
        if idx not in latest_row:
            continue
        latest_val = float(latest_row[idx])

        # 7-day change
        idx_7d = min(7, len(rows) - 1)
        val_7d = float(rows[idx_7d][idx]) if len(rows) > 1 else latest_val
        change_7d = round(latest_val - val_7d, 2)
        change_7d_pct = round((change_7d / val_7d * 100) if val_7d > 0 else 0.0, 2)

        # 30-day change
        idx_30d = len(rows) - 1
        val_30d = float(rows[idx_30d][idx]) if len(rows) > 1 else latest_val
        change_30d = round(latest_val - val_30d, 2)
        change_30d_pct = round((change_30d / val_30d * 100) if val_30d > 0 else 0.0, 2)

        # Sparkline: chronological series guaranteed to have exactly 30 numbers
        raw_series = [float(r[idx]) for r in chronological if idx in r and r[idx] is not None]
        if not raw_series:
            raw_series = [latest_val]

        if len(raw_series) < 30:
            earliest = raw_series[0]
            padded = [earliest] * (30 - len(raw_series)) + raw_series
        else:
            padded = raw_series[-30:]

        metrics[idx] = {
            "current": latest_val,
            "change_7d": change_7d,
            "change_7d_pct": change_7d_pct,
            "change_30d": change_30d,
            "change_30d_pct": change_30d_pct,
            "sparkline": padded,
        }

    latest_row["metrics"] = metrics
    return latest_row



def query_latest_pinksheet() -> dict[str, Any]:
    """Return the most recent row from pinksheet."""
    row = _conn.execute(
        "SELECT * FROM pinksheet ORDER BY date DESC LIMIT 1"
    ).fetchdf().to_dict(orient="records")
    return row[0] if row else {}


def query_latest_usdinr() -> dict[str, Any]:
    """Return the most recent USD/INR rate."""
    row = _conn.execute(
        "SELECT * FROM usdinr ORDER BY date DESC LIMIT 1"
    ).fetchdf().to_dict(orient="records")
    return row[0] if row else {}


# ---------------------------------------------------------------------------
# Query helpers — live & demo vessels
# ---------------------------------------------------------------------------

def _vessel_rows_to_dicts(rows: list) -> list[dict]:
    """Convert raw DB rows to dicts with column names."""
    if not rows:
        return []
    cols = [
        "mmsi", "name", "imo", "callsign", "ship_type",
        "dim_a", "dim_b", "dim_c", "dim_d", "loa", "beam", "draft",
        "destination", "eta", "latitude", "longitude",
        "speed", "course", "heading", "nav_status",
        "inferred_class", "last_seen", "is_seeded",
    ]
    result = []
    for row in rows:
        d = dict(zip(cols, row))
        if d.get("last_seen") and hasattr(d["last_seen"], "isoformat"):
            d["last_seen"] = d["last_seen"].isoformat()
        d["is_seeded"] = bool(d.get("is_seeded", 0))
        result.append(d)
    return result


def query_live_vessels(
    bbox: tuple[float, float, float, float] | None = None,
    min_dwt: float | None = None,
    max_dwt: float | None = None,
) -> list[dict]:
    """Return current live or seeded demo vessels, adhering to live-precedence rule.

    Precedence rule:
      If real AIS vessels are present (is_seeded = 0), serve real live vessels.
      If real AIS is empty/unavailable and DEMO_MODE is true, serve seeded fleet.
    """
    seed_demo_fleet_if_needed()
    use_live = has_live_ais_vessels()

    sql = "SELECT * FROM live_vessels WHERE 1=1"
    params: list = []

    if use_live:
        sql += " AND is_seeded = 0"
    elif is_demo_mode_enabled():
        sql += " AND is_seeded = 1"
    else:
        sql += " AND is_seeded = 0"

    if bbox:
        lat_min, lng_min, lat_max, lng_max = bbox
        sql += " AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?"
        params.extend([lat_min, lat_max, lng_min, lng_max])

    if min_dwt is not None or max_dwt is not None:
        class_filters = _get_classes_in_dwt_range(min_dwt, max_dwt)
        if class_filters:
            placeholders = ", ".join(["?"] * len(class_filters))
            sql += f" AND inferred_class IN ({placeholders})"
            params.extend(class_filters)
        else:
            return []

    sql += " ORDER BY last_seen DESC"

    try:
        with _get_vessels_conn() as conn:
            rows = conn.execute(sql, params).fetchall()
            return _vessel_rows_to_dicts(rows)
    except Exception as exc:
        log.warning("query_live_vessels failed: %s", exc)
        return []


def _get_classes_in_dwt_range(
    min_dwt: float | None, max_dwt: float | None
) -> list[str]:
    """Return vessel class names whose DWT range overlaps [min_dwt, max_dwt]."""
    classes = {
        "Handysize": (15000, 40000),
        "Supramax": (40000, 65000),
        "Panamax": (65000, 80000),
        "Kamsarmax": (80000, 84000),
        "Capesize": (100000, 210000),
    }
    result = []
    lo = min_dwt or 0
    hi = max_dwt or float("inf")
    for name, (dwt_lo, dwt_hi) in classes.items():
        if dwt_hi >= lo and dwt_lo <= hi:
            result.append(name)
    return result


def query_vessel_by_mmsi(mmsi: int) -> dict | None:
    """Return a single vessel profile by MMSI."""
    seed_demo_fleet_if_needed()
    try:
        with _get_vessels_conn() as conn:
            row = conn.execute(
                "SELECT * FROM live_vessels WHERE mmsi = ?", [mmsi]
            ).fetchone()
            if row:
                return _vessel_rows_to_dicts([row])[0]
    except Exception as exc:
        log.warning("query_vessel_by_mmsi(%s) failed: %s", mmsi, exc)
    return None


# Destination patterns that indicate the vessel is heading to East Coast India
INDIA_EAST_COAST_DEST_PATTERNS = [
    "PARADIP", "IN PAR", "INPAR",
    "VIZAG", "VISAKHAPATNAM", "IN VTZ", "INVTZ",
    "GANGAVARAM", "IN GAN", "INGAN",
    "GOPALPUR", "IN GOP", "INGOP",
    "DHAMRA", "IN DHM", "INDHM",
    "HALDIA", "IN HAL", "INHAL",
    "KOLKATA", "IN CCU", "INCCU", "CALCUTTA",
    "SANDHEADS", "IN SAN", "INSAN", "SAGAR",
    "KAKINADA", "IN KAK", "INKAK",
    "KRISHNAPATNAM", "IN KRI",
    "ENNORE", "IN ENR",
    "CHENNAI", "IN MAA",
    "TUTICORIN", "IN TUT",
]


def query_vessels_heading_india() -> list[dict]:
    """Return vessels whose AIS destination matches East Coast India ports.

    Sorted by ETA (earliest first, nulls last).
    """
    seed_demo_fleet_if_needed()
    use_live = has_live_ais_vessels()

    like_clauses = " OR ".join(
        [f"UPPER(destination) LIKE ?" for _ in INDIA_EAST_COAST_DEST_PATTERNS]
    )
    params = [f"%{p}%" for p in INDIA_EAST_COAST_DEST_PATTERNS]

    if use_live:
        seeded_clause = "AND is_seeded = 0"
    elif is_demo_mode_enabled():
        seeded_clause = "AND is_seeded = 1"
    else:
        seeded_clause = "AND is_seeded = 0"

    sql = f"""
        SELECT * FROM live_vessels
        WHERE ({like_clauses}) {seeded_clause}
        ORDER BY eta ASC NULLS LAST, last_seen DESC
    """

    try:
        with _get_vessels_conn() as conn:
            rows = conn.execute(sql, params).fetchall()
            return _vessel_rows_to_dicts(rows)
    except Exception as exc:
        log.warning("query_vessels_heading_india failed: %s", exc)
        return []


def query_fleet_status() -> dict[str, Any]:
    """Return status of live vs seeded vessel storage."""
    seed_demo_fleet_if_needed()
    live_active = has_live_ais_vessels()
    demo_enabled = is_demo_mode_enabled()

    try:
        with _get_vessels_conn() as conn:
            live_count = conn.execute("SELECT COUNT(*) FROM live_vessels WHERE is_seeded = 0").fetchone()[0]
            seeded_count = conn.execute("SELECT COUNT(*) FROM live_vessels WHERE is_seeded = 1").fetchone()[0]
    except Exception:
        live_count, seeded_count = 0, 0

    return {
        "fleet_source": "live" if live_active else ("seeded" if demo_enabled and seeded_count > 0 else "empty"),
        "is_demo_mode": demo_enabled,
        "has_live_ais": live_active,
        "live_vessel_count": live_count,
        "seeded_vessel_count": seeded_count,
        "display_count": live_count if live_active else seeded_count,
    }


def query_port_congestion(port_id: str) -> dict[str, Any]:
    """Query live waiting vessels (speed < 1.0 kn) in port anchorage zone and estimate wait."""
    port = get_port_by_id(port_id)
    if not port:
        return {}

    lat = float(port["lat"])
    lng = float(port["lng"])
    baseline_hours = float(port.get("avg_turnaround_hours", 72.0))
    radius = float(port.get("anchorage_radius_deg", 0.35))

    waiting_count = 0
    try:
        with _get_vessels_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT COUNT(*) FROM live_vessels
                WHERE speed < 1.0
                  AND latitude BETWEEN ? AND ?
                  AND longitude BETWEEN ? AND ?
                """,
                (lat - radius, lat + radius, lng - radius, lng + radius),
            )
            row = cursor.fetchone()
            if row:
                waiting_count = int(row[0])
    except Exception as exc:
        log.warning("query_port_congestion failed: %s", exc)

    if waiting_count > 0:
        expected_wait = round(waiting_count * (baseline_hours / 6.0) + (baseline_hours * 0.4), 1)
        data_source = "live_ais"
    else:
        # Realistic fallback when AIS coverage is thin in free-tier box
        waiting_count = max(1, int(round(baseline_hours / 24.0)))
        expected_wait = round(baseline_hours, 1)
        data_source = "baseline"

    if expected_wait <= 48:
        congestion_level = "low"
    elif expected_wait <= 84:
        congestion_level = "moderate"
    else:
        congestion_level = "high"

    return {
        "port_id": port_id,
        "port_name": port["name"],
        "waiting_vessels": waiting_count,
        "expected_wait_hours": expected_wait,
        "baseline_turnaround_hours": baseline_hours,
        "congestion_level": congestion_level,
        "data_source": data_source,
        "anchorage_bounds": {
            "lat_min": round(lat - radius, 3),
            "lat_max": round(lat + radius, 3),
            "lng_min": round(lng - radius, 3),
            "lng_max": round(lng + radius, 3),
        },
    }

