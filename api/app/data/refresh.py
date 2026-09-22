"""Market Data Refresh Script for CargoX.

Pulls and refreshes external market benchmarks with zero paid infrastructure:
1. Latest USD/INR exchange rate from Frankfurter API (ECB reference rate) -> data/usdinr.csv
2. World Bank Pink Sheet monthly commodity prices (Iron ore, Coal, Crude) -> data/pinksheet.csv
3. Caches updated data into the database.

SCHEDULING NOTE:
  In production, this script can be executed once daily or monthly via:
    - A standard local cron job: `0 6 * * 1-5 /path/to/venv/bin/python -m app.data.refresh`
    - A free GitHub Actions scheduled workflow (.github/workflows/data_refresh.yml)
  No paid infrastructure or always-on queue is required.
"""

from __future__ import annotations

import io
import logging
import re
from pathlib import Path
from typing import Any

import httpx
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
)
log = logging.getLogger("data_refresh")

_API_DIR = Path(__file__).resolve().parent.parent.parent
_DATA_DIR = _API_DIR.parent / "data"

PRIMARY_PINKSHEET_URL = (
    "https://thedocs.worldbank.org/en/doc/5d903e848db1d1b83e0ec8f744e55570-0350012021"
    "/related/CMO-Historical-Data-Monthly.xlsx"
)
WORLDBANK_LANDING_PAGE = "https://www.worldbank.org/en/research/commodity-markets"
FRANKFURTER_API_URL = "https://api.frankfurter.app/latest?from=USD&to=INR"


# ---------------------------------------------------------------------------
# 1. USD / INR FX Refresh
# ---------------------------------------------------------------------------

def refresh_usdinr(data_dir: Path | None = None) -> float | None:
    """Fetch latest USD/INR from Frankfurter API and update data/usdinr.csv."""
    dir_path = data_dir or _DATA_DIR
    csv_path = dir_path / "usdinr.csv"

    log.info("Fetching latest USD/INR from Frankfurter API: %s", FRANKFURTER_API_URL)
    try:
        with httpx.Client(timeout=15.0, follow_redirects=True) as client:
            resp = client.get(FRANKFURTER_API_URL)
            resp.raise_for_status()
            data = resp.json()

        rate = float(data["rates"]["INR"])
        quote_date = str(data["date"])
        log.info("Successfully fetched USD/INR: %.4f (as of %s)", rate, quote_date)

        # Update CSV
        if csv_path.exists():
            df = pd.read_csv(csv_path)
            # Check if date exists, else append
            if quote_date in df["date"].values:
                df.loc[df["date"] == quote_date, "usd_inr"] = rate
            else:
                new_row = pd.DataFrame([{"date": quote_date, "usd_inr": rate}])
                df = pd.concat([df, new_row], ignore_index=True)
            df = df.sort_values("date").reset_index(drop=True)
            df.to_csv(csv_path, index=False)
            log.info("Updated %s with latest rate (total %d rows)", csv_path.name, len(df))
        else:
            df = pd.DataFrame([{"date": quote_date, "usd_inr": rate}])
            df.to_csv(csv_path, index=False)
            log.info("Created %s with initial rate", csv_path.name)

        return rate

    except Exception as exc:
        log.warning("Failed to refresh USD/INR: %s. Using existing cache.", exc)
        return None


# ---------------------------------------------------------------------------
# 2. World Bank Pink Sheet Refresh
# ---------------------------------------------------------------------------

def _download_pinksheet_excel() -> bytes | None:
    """Download Pink Sheet Excel workbook with primary URL and landing page fallback."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CargoX Data Ingestion",
    }

    # Attempt Primary URL
    log.info("Downloading World Bank Pink Sheet from primary URL: %s", PRIMARY_PINKSHEET_URL)
    primary_failed = False
    try:
        with httpx.Client(timeout=45.0, follow_redirects=True, headers=headers) as client:
            resp = client.get(PRIMARY_PINKSHEET_URL)
            if resp.status_code == 200 and len(resp.content) > 10000:
                log.info("Downloaded %d bytes from primary Pink Sheet URL", len(resp.content))
                return resp.content
            else:
                log.warning("Primary Pink Sheet URL returned HTTP %d (404 or unexpected status)", resp.status_code)
                primary_failed = True
    except Exception as exc:
        log.warning("Error fetching primary Pink Sheet URL: %s", exc)
        primary_failed = True

    # Attempt Fallback: Inspect World Bank Commodity Markets Landing Page if primary 404s/fails
    if primary_failed:
        log.info("Primary URL failed. Attempting landing page fallback: %s", WORLDBANK_LANDING_PAGE)
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True, headers=headers) as client:
                resp = client.get(WORLDBANK_LANDING_PAGE)
                if resp.status_code == 200:
                    html = resp.text
                    # Look for monthly spreadsheet link
                    matches = re.findall(r'href="([^"]+CMO-Historical-Data-Monthly[^"]*\.xlsx)"', html, re.IGNORECASE)
                    if not matches:
                        matches = re.findall(r'href="([^"]+Monthly[^"]*\.xlsx)"', html, re.IGNORECASE)

                    if matches:
                        found_url = matches[0]
                        if not found_url.startswith("http"):
                            found_url = f"https://www.worldbank.org{found_url}"
                        log.info("Found candidate Excel URL on landing page: %s", found_url)

                        sub_resp = client.get(found_url)
                        if sub_resp.status_code == 200 and len(sub_resp.content) > 10000:
                            log.info("Successfully downloaded %d bytes from fallback URL", len(sub_resp.content))
                            return sub_resp.content
        except Exception as exc:
            log.warning("Landing page fallback failed: %s", exc)

    log.warning("Pink Sheet URL may have changed — check manually.")
    return None


def refresh_pinksheet(data_dir: Path | None = None) -> bool:
    """Download World Bank Pink Sheet Excel, parse relevant commodity rows, and save to CSV."""
    dir_path = data_dir or _DATA_DIR
    csv_path = dir_path / "pinksheet.csv"

    content = _download_pinksheet_excel()
    if not content:
        if csv_path.exists():
            log.info("Pink Sheet refresh failed. Running on cached %s.", csv_path.name)
            return False
        else:
            log.error("No existing %s found and download failed.", csv_path.name)
            return False

    try:
        log.info("Parsing 'Monthly Prices' sheet using openpyxl...")
        xl = pd.ExcelFile(io.BytesIO(content), engine="openpyxl")
        if "Monthly Prices" not in xl.sheet_names:
            log.warning("Sheet 'Monthly Prices' not in %s. Available: %s", xl.sheet_names, csv_path.name)
            return False

        df = xl.parse("Monthly Prices")
        # Column 0: Date string (e.g. 2024M09)
        # Column 1: Crude oil, average ($/bbl)
        # Column 5: Coal, Australian ($/mt)
        # Column 6: Coal, South African ($/mt)
        # Column 63: Iron ore, cfr spot ($/dmtu)
        sub = df.iloc[5:, [0, 63, 5, 6, 1]].copy()
        sub.columns = ["date_str", "iron_ore_usd_dmt", "coal_au_usd_mt", "coal_sa_usd_mt", "crude_avg_usd_bbl"]

        def parse_date(s: Any) -> str | None:
            s_str = str(s).strip()
            if "M" in s_str:
                parts = s_str.split("M")
                if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                    return f"{parts[0]}-{parts[1].zfill(2)}-01"
            return None

        sub["date"] = sub["date_str"].apply(parse_date)
        sub = sub.dropna(subset=["date"])

        target_cols = ["date", "iron_ore_usd_dmt", "coal_au_usd_mt", "coal_sa_usd_mt", "crude_avg_usd_bbl"]
        clean_df = sub[target_cols].copy()
        for c in target_cols[1:]:
            clean_df[c] = pd.to_numeric(clean_df[c], errors="coerce")

        clean_df = clean_df.dropna().sort_values("date").reset_index(drop=True)
        clean_df.to_csv(csv_path, index=False)
        log.info("Successfully refreshed %s: %d monthly rows (latest: %s)", csv_path.name, len(clean_df), clean_df["date"].iloc[-1])
        return True

    except Exception as exc:
        log.error("Failed to parse Pink Sheet Excel: %s. Continuing on cached %s.", exc, csv_path.name)
        return False


# ---------------------------------------------------------------------------
# 3. Cache to Database
# ---------------------------------------------------------------------------

def cache_to_db() -> None:
    """Reload DuckDB market tables in the running API process if available."""
    try:
        from app.db import init_db
        init_db()
        log.info("Successfully reloaded DuckDB market cache.")
    except Exception as exc:
        log.info("DuckDB in-process reload skipped (will be loaded on next startup): %s", exc)


# ---------------------------------------------------------------------------
# Main Runner
# ---------------------------------------------------------------------------

def run_refresh() -> dict[str, Any]:
    """Execute complete data refresh workflow."""
    log.info("Starting CargoX Market Data Ingestion Refresh...")
    fx_rate = refresh_usdinr()
    pinksheet_ok = refresh_pinksheet()
    cache_to_db()

    summary = {
        "status": "completed",
        "usd_inr": fx_rate,
        "pinksheet_refreshed": pinksheet_ok,
    }
    log.info("Data refresh complete: %s", summary)
    return summary


if __name__ == "__main__":
    run_refresh()
