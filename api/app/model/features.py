"""Feature engineering and dataset builder for freight forecasting models.

Loads daily Baltic Exchange dry bulk index history (BDI, BCI, BPI, BSI, BHSI),
merges exogenous features from World Bank Pink Sheet (crude, iron ore, coal)
and USD/INR exchange rates, and constructs autoregressive, rolling, calendar,
and exogenous features.

Feature leakage guard:
  Exogenous features from monthly Pink Sheet are lagged by one monthly period
  before forward-filling into daily frequency ("Exogenous features are lagged
  by one period to prevent look-ahead bias").
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

# Default locations
_API_DIR = Path(__file__).resolve().parent.parent.parent
_DATA_DIR = _API_DIR.parent / "data"

FEATURE_COLS = [
    "lag_1",
    "lag_7",
    "lag_14",
    "lag_28",
    "rolling_mean_7",
    "rolling_std_7",
    "rolling_mean_28",
    "rolling_std_28",
    "target_7d_chg",
    "target_28d_chg",
    "day_of_week",
    "week_of_year",
    "month",
    "crude_avg_usd_bbl",
    "iron_ore_usd_dmt",
    "coal_au_usd_mt",
    "coal_sa_usd_mt",
    "usd_inr",
    "crude_7d_chg",
    "iron_ore_7d_chg",
    "coal_au_7d_chg",
    "usd_inr_7d_chg",
]


def load_raw_datasets(data_dir: Path | None = None) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load bdi_history, pinksheet, and usdinr CSVs."""
    dir_path = data_dir or _DATA_DIR
    bdi_path = dir_path / "bdi_history.csv"
    pinksheet_path = dir_path / "pinksheet.csv"
    usdinr_path = dir_path / "usdinr.csv"

    if not bdi_path.exists():
        raise FileNotFoundError(f"Missing BDI history at {bdi_path}")
    if not pinksheet_path.exists():
        raise FileNotFoundError(f"Missing Pink Sheet at {pinksheet_path}")
    if not usdinr_path.exists():
        raise FileNotFoundError(f"Missing USD/INR at {usdinr_path}")

    bdi = pd.read_csv(bdi_path)
    ps = pd.read_csv(pinksheet_path)
    fx = pd.read_csv(usdinr_path)

    bdi["date"] = pd.to_datetime(bdi["date"])
    ps["date"] = pd.to_datetime(ps["date"])
    fx["date"] = pd.to_datetime(fx["date"])

    bdi = bdi.sort_values("date").reset_index(drop=True)
    ps = ps.sort_values("date").reset_index(drop=True)
    fx = fx.sort_values("date").reset_index(drop=True)

    return bdi, ps, fx


def build_merged_dataset(data_dir: Path | None = None) -> pd.DataFrame:
    """Merge BDI history with exogenous Pink Sheet and USD/INR series.

    Exogenous features are lagged by one period to prevent look-ahead bias:
    monthly Pink Sheet data from month M is only assumed known starting in
    month M+1, so we shift monthly values by 1 before forward-filling.
    """
    bdi, ps, fx = load_raw_datasets(data_dir)

    # Lagged 1 period to prevent look-ahead bias
    ps_lagged = ps.copy()
    numeric_ps_cols = [c for c in ps_lagged.columns if c != "date"]
    ps_lagged[numeric_ps_cols] = ps_lagged[numeric_ps_cols].shift(1)

    # Merge onto daily BDI dates
    merged = pd.merge_asof(
        bdi.sort_values("date"),
        ps_lagged.sort_values("date"),
        on="date",
        direction="backward",
    )

    merged = pd.merge(merged, fx, on="date", how="left")

    # Forward-fill any minor gaps in fx or ps
    merged = merged.ffill().bfill()
    return merged.sort_values("date").reset_index(drop=True)


def build_feature_dataframe(
    df: pd.DataFrame,
    target_index: str = "BDI",
) -> pd.DataFrame:
    """Construct autoregressive, rolling, calendar, and exogenous features.

    Parameters
    ----------
    df : pd.DataFrame
        Merged dataframe from ``build_merged_dataset``.
    target_index : str
        Target column name (e.g. 'BDI', 'BCI', 'BPI', 'BSI', 'BHSI').

    Returns
    -------
    pd.DataFrame with feature columns and target.
    """
    if target_index not in df.columns:
        raise ValueError(f"Target index '{target_index}' not found in dataset columns: {list(df.columns)}")

    feat_df = df.copy()
    y = feat_df[target_index]

    # Target lags
    feat_df["lag_1"] = y.shift(1)
    feat_df["lag_7"] = y.shift(7)
    feat_df["lag_14"] = y.shift(14)
    feat_df["lag_28"] = y.shift(28)

    # Rolling statistics over past values (using lag_1 as baseline to avoid target leakage)
    feat_df["rolling_mean_7"] = y.shift(1).rolling(7, min_periods=1).mean()
    feat_df["rolling_std_7"] = y.shift(1).rolling(7, min_periods=2).std().fillna(0)
    feat_df["rolling_mean_28"] = y.shift(1).rolling(28, min_periods=1).mean()
    feat_df["rolling_std_28"] = y.shift(1).rolling(28, min_periods=2).std().fillna(0)

    # Target momentum
    feat_df["target_7d_chg"] = feat_df["lag_1"] - feat_df["lag_7"]
    feat_df["target_28d_chg"] = feat_df["lag_1"] - feat_df["lag_28"]

    # Calendar seasonality
    dates = pd.to_datetime(feat_df["date"])
    feat_df["day_of_week"] = dates.dt.dayofweek
    feat_df["week_of_year"] = dates.dt.isocalendar().week.astype(int)
    feat_df["month"] = dates.dt.month

    # Exogenous 7-day changes
    feat_df["crude_7d_chg"] = feat_df["crude_avg_usd_bbl"] - feat_df["crude_avg_usd_bbl"].shift(7)
    feat_df["iron_ore_7d_chg"] = feat_df["iron_ore_usd_dmt"] - feat_df["iron_ore_usd_dmt"].shift(7)
    feat_df["coal_au_7d_chg"] = feat_df["coal_au_usd_mt"] - feat_df["coal_au_usd_mt"].shift(7)
    feat_df["usd_inr_7d_chg"] = feat_df["usd_inr"] - feat_df["usd_inr"].shift(7)

    # Target column
    feat_df["target"] = y

    # Forward-fill initial missing rolling/shifts then drop rows with remaining NaNs
    feat_df = feat_df.dropna().reset_index(drop=True)
    return feat_df
