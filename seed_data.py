"""Generate synthetic seed CSVs for CargoX development.

Run once: python seed_data.py
Output: data/bdi_history.csv, data/pinksheet.csv, data/usdinr.csv
"""

import csv
import math
import os
import random
from datetime import date, timedelta

random.seed(42)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def mean_revert(prev: float, mu: float, kappa: float, sigma: float) -> float:
    """Ornstein–Uhlenbeck-style step for realistic mean-reverting series."""
    shock = random.gauss(0, sigma)
    return prev + kappa * (mu - prev) + shock


def clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


# ---------------------------------------------------------------------------
# 1. BDI history — ~2 years daily (weekdays only, matching Baltic Exchange)
# ---------------------------------------------------------------------------

def generate_bdi(start: date, end: date) -> list[dict]:
    rows = []
    # Starting values (mid-range)
    bci, bpi, bsi, bhsi = 1800.0, 1400.0, 1100.0, 800.0
    day = start
    while day <= end:
        # Skip weekends (Baltic Exchange publishes Mon-Fri)
        if day.weekday() < 5:
            # Mean-revert each sub-index
            bci = clamp(mean_revert(bci, 2000, 0.02, 80), 400, 6000)
            bpi = clamp(mean_revert(bpi, 1400, 0.02, 50), 300, 4000)
            bsi = clamp(mean_revert(bsi, 1100, 0.02, 35), 250, 3000)
            bhsi = clamp(mean_revert(bhsi, 800, 0.02, 25), 200, 2000)

            # Add seasonal component (Q4 tends higher)
            doy = day.timetuple().tm_yday
            seasonal = 1.0 + 0.08 * math.sin(2 * math.pi * (doy - 90) / 365)
            bci_adj = round(bci * seasonal)
            bpi_adj = round(bpi * seasonal)
            bsi_adj = round(bsi * seasonal)
            bhsi_adj = round(bhsi * seasonal)

            # BDI is roughly a weighted composite
            bdi = round(0.40 * bci_adj + 0.30 * bpi_adj + 0.20 * bsi_adj + 0.10 * bhsi_adj)

            rows.append({
                "date": day.isoformat(),
                "BDI": bdi,
                "BCI": bci_adj,
                "BPI": bpi_adj,
                "BSI": bsi_adj,
                "BHSI": bhsi_adj,
            })
        day += timedelta(days=1)
    return rows


# ---------------------------------------------------------------------------
# 2. Pink sheet — ~3 years monthly
# ---------------------------------------------------------------------------

def generate_pinksheet(start: date, end: date) -> list[dict]:
    rows = []
    iron = 110.0    # USD/dmt
    coal_au = 200.0  # USD/mt
    coal_sa = 150.0  # USD/mt
    crude = 78.0     # USD/bbl
    day = start
    while day <= end:
        iron = clamp(mean_revert(iron, 105, 0.05, 6), 60, 180)
        coal_au = clamp(mean_revert(coal_au, 180, 0.04, 15), 80, 450)
        coal_sa = clamp(mean_revert(coal_sa, 130, 0.04, 12), 60, 350)
        crude = clamp(mean_revert(crude, 75, 0.06, 5), 45, 130)
        rows.append({
            "date": day.isoformat(),
            "iron_ore_usd_dmt": round(iron, 2),
            "coal_au_usd_mt": round(coal_au, 2),
            "coal_sa_usd_mt": round(coal_sa, 2),
            "crude_avg_usd_bbl": round(crude, 2),
        })
        # Advance ~1 month
        if day.month == 12:
            day = day.replace(year=day.year + 1, month=1)
        else:
            day = day.replace(month=day.month + 1)
    return rows


# ---------------------------------------------------------------------------
# 3. USD/INR — ~2 years daily
# ---------------------------------------------------------------------------

def generate_usdinr(start: date, end: date) -> list[dict]:
    rows = []
    rate = 83.0
    day = start
    while day <= end:
        if day.weekday() < 5:
            rate = clamp(mean_revert(rate, 83.5, 0.005, 0.15), 78, 90)
            rows.append({
                "date": day.isoformat(),
                "usd_inr": round(rate, 4),
            })
        day += timedelta(days=1)
    return rows


# ---------------------------------------------------------------------------
# Write CSVs
# ---------------------------------------------------------------------------

def write_csv(path: str, rows: list[dict]):
    if not rows:
        return
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"  ✔ {path}  ({len(rows)} rows)")


if __name__ == "__main__":
    today = date(2026, 9, 22)

    print("Generating seed data …")
    bdi_start = today - timedelta(days=730)
    write_csv(
        os.path.join(DATA_DIR, "bdi_history.csv"),
        generate_bdi(bdi_start, today),
    )

    ps_start = today.replace(year=today.year - 3, day=1)
    write_csv(
        os.path.join(DATA_DIR, "pinksheet.csv"),
        generate_pinksheet(ps_start, today),
    )

    fx_start = today - timedelta(days=730)
    write_csv(
        os.path.join(DATA_DIR, "usdinr.csv"),
        generate_usdinr(fx_start, today),
    )

    print("Done.")
