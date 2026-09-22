"""Runtime freight forecasting service.

Loads pre-trained LightGBM quantile artifacts and serves multi-step (28-day)
index forecasts with P10/P50/P90 bands. If artifacts are missing, gracefully
falls back to a seasonal-naive baseline so the endpoint never fails.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor

from app.engine.cost import compute_cost
from app.engine.distance import get_distance
from app.model.features import (
    FEATURE_COLS,
    build_merged_dataset,
)

log = logging.getLogger(__name__)

_APP_DIR = Path(__file__).resolve().parent.parent
DEFAULT_ARTIFACTS_DIR = _APP_DIR / "model" / "artifacts"


class FreightForecastService:
    """Manages loaded forecasting models and runs inference."""

    def __init__(self, artifacts_dir: Path | None = None) -> None:
        self.artifacts_dir = artifacts_dir or DEFAULT_ARTIFACTS_DIR
        self.models: dict[str, dict[str, LGBMRegressor]] = {}  # index -> {p10, p50, p90}
        self.metadata: dict[str, dict[str, Any]] = {}
        self.metrics: dict[str, Any] = {}
        self.merged_df: pd.DataFrame | None = None
        self._load_all()

    def _load_all(self) -> None:
        """Attempt to load all trained models and metrics on startup."""
        log.info("Loading freight forecasting service artifacts from %s", self.artifacts_dir)
        try:
            self.merged_df = build_merged_dataset()
        except Exception as exc:
            log.warning("Could not build base dataset for forecasting: %s", exc)

        # Load metrics.json if present
        metrics_file = self.artifacts_dir / "metrics.json"
        if metrics_file.exists():
            try:
                with open(metrics_file, "r") as f:
                    self.metrics = json.load(f)
            except Exception as exc:
                log.warning("Failed to parse metrics.json: %s", exc)

        # Load known index models
        for idx in ["BDI", "BCI", "BPI", "BSI", "BHSI"]:
            meta_file = self.artifacts_dir / f"{idx}_meta.json"
            p50_file = self.artifacts_dir / f"{idx}_model_p50.joblib"

            if meta_file.exists() and p50_file.exists():
                try:
                    with open(meta_file, "r") as f:
                        self.metadata[idx] = json.load(f)
                    p50_model = joblib.load(p50_file)
                    p10_model = joblib.load(self.artifacts_dir / f"{idx}_model_p10.joblib")
                    p90_model = joblib.load(self.artifacts_dir / f"{idx}_model_p90.joblib")
                    self.models[idx] = {
                        "p10": p10_model,
                        "p50": p50_model,
                        "p90": p90_model,
                    }
                    log.info("Loaded model artifacts for index: %s", idx)
                except Exception as exc:
                    log.warning("Error loading artifacts for index %s: %s", idx, exc)

    def is_model_available(self, index_name: str) -> bool:
        return index_name in self.models and index_name in self.metadata

    # ── Forecasting ──────────────────────────────────────────────────────────

    def forecast_index(
        self,
        index_name: str = "BDI",
        horizon: int = 28,
    ) -> dict[str, Any]:
        """Generate 28-day P10/P50/P90 forecast for the requested Baltic index."""
        index_name = index_name.upper()
        horizon = max(1, min(horizon, 28))

        if self.is_model_available(index_name) and self.merged_df is not None:
            return self._predict_with_lightgbm(index_name, horizon)
        else:
            log.info("Model not available for %s — using seasonal naive fallback.", index_name)
            return self._predict_seasonal_naive_fallback(index_name, horizon)

    def _predict_with_lightgbm(self, index_name: str, horizon: int) -> dict[str, Any]:
        """Recursive 1-step prediction + empirical quantile residual widening."""
        meta = self.metadata[index_name]
        model_p50 = self.models[index_name]["p50"]
        q10_offsets = meta.get("q10_offsets", [-50.0] * 28)
        q90_offsets = meta.get("q90_offsets", [50.0] * 28)

        # Get latest historical data
        assert self.merged_df is not None
        hist_df = self.merged_df.copy()
        last_date = pd.to_datetime(hist_df["date"].iloc[-1])
        last_crude = float(hist_df["crude_avg_usd_bbl"].iloc[-1])
        last_ore = float(hist_df["iron_ore_usd_dmt"].iloc[-1])
        last_coal_au = float(hist_df["coal_au_usd_mt"].iloc[-1])
        last_coal_sa = float(hist_df["coal_sa_usd_mt"].iloc[-1])
        last_fx = float(hist_df["usd_inr"].iloc[-1])

        p50_preds: list[float] = []
        p10_preds: list[float] = []
        p90_preds: list[float] = []
        dates: list[str] = []

        current_date = last_date
        sim_series = list(hist_df[index_name].values)

        for h in range(1, horizon + 1):
            current_date = current_date + pd.Timedelta(days=1)
            dates.append(current_date.strftime("%Y-%m-%d"))

            n = len(sim_series)
            lag_1 = float(sim_series[-1])
            lag_7 = float(sim_series[-7]) if n >= 7 else lag_1
            lag_14 = float(sim_series[-14]) if n >= 14 else lag_1
            lag_28 = float(sim_series[-28]) if n >= 28 else lag_1

            rolling_7 = float(np.mean(sim_series[-7:])) if n >= 7 else lag_1
            rolling_7_std = float(np.std(sim_series[-7:])) if n >= 7 else 0.0
            rolling_28 = float(np.mean(sim_series[-28:])) if n >= 28 else lag_1
            rolling_28_std = float(np.std(sim_series[-28:])) if n >= 28 else 0.0

            feat_row = pd.DataFrame([{
                "lag_1": lag_1,
                "lag_7": lag_7,
                "lag_14": lag_14,
                "lag_28": lag_28,
                "rolling_mean_7": rolling_7,
                "rolling_std_7": rolling_7_std,
                "rolling_mean_28": rolling_28,
                "rolling_std_28": rolling_28_std,
                "target_7d_chg": lag_1 - lag_7,
                "target_28d_chg": lag_1 - lag_28,
                "day_of_week": current_date.dayofweek,
                "week_of_year": int(current_date.isocalendar()[1]),
                "month": current_date.month,
                "crude_avg_usd_bbl": last_crude,
                "iron_ore_usd_dmt": last_ore,
                "coal_au_usd_mt": last_coal_au,
                "coal_sa_usd_mt": last_coal_sa,
                "usd_inr": last_fx,
                "crude_7d_chg": 0.0,
                "iron_ore_7d_chg": 0.0,
                "coal_au_7d_chg": 0.0,
                "usd_inr_7d_chg": 0.0,
            }])[FEATURE_COLS]

            p50_val = float(model_p50.predict(feat_row)[0])
            p50_val = max(100.0, p50_val)  # indices are strictly positive
            sim_series.append(p50_val)

            # Apply empirical quantile offsets
            q10 = q10_offsets[h - 1] if h - 1 < len(q10_offsets) else q10_offsets[-1]
            q90 = q90_offsets[h - 1] if h - 1 < len(q90_offsets) else q90_offsets[-1]

            p10_val = max(50.0, min(p50_val, p50_val + q10))
            p90_val = max(p50_val, p50_val + q90)

            p50_preds.append(round(p50_val, 1))
            p10_preds.append(round(p10_val, 1))
            p90_preds.append(round(p90_val, 1))

        # Trend calculation: compare end of horizon vs starting point
        initial_val = float(hist_df[index_name].iloc[-1])
        final_val = p50_preds[-1]
        pct_change = ((final_val - initial_val) / initial_val) * 100.0
        if pct_change >= 2.0:
            trend = "up"
        elif pct_change <= -2.0:
            trend = "down"
        else:
            trend = "flat"

        # Confidence: calibrated from backtest coverage and relative band width
        metric_info = self.metrics.get(index_name, {}).get("lightgbm", {})
        cov = metric_info.get("interval_coverage_80pct", 80.0) / 100.0
        mape = metric_info.get("p50_mape_pct", 10.0)
        # Scaled between 0.60 and 0.95
        confidence = float(np.clip(cov * (1.0 - mape / 100.0) * 1.1, 0.55, 0.95))

        return {
            "index": index_name,
            "horizon": horizon,
            "dates": dates,
            "p10": p10_preds,
            "p50": p50_preds,
            "p90": p90_preds,
            "trend": trend,
            "confidence": round(confidence, 2),
            "model_metrics": self.metrics.get(index_name, {}),
            "is_fallback": False,
        }

    def _predict_seasonal_naive_fallback(
        self, index_name: str, horizon: int
    ) -> dict[str, Any]:
        """Graceful fallback: persists seasonal 28-day lags with widening bounds."""
        if self.merged_df is not None and index_name in self.merged_df.columns:
            series = self.merged_df[index_name].values
            last_date = pd.to_datetime(self.merged_df["date"].iloc[-1])
        else:
            # Synthetic default values
            series = np.array([1400.0] * 30)
            last_date = pd.Timestamp.now()

        p50_preds = []
        p10_preds = []
        p90_preds = []
        dates = []

        std_dev = float(np.std(series[-28:])) if len(series) >= 28 else 80.0
        hist_list = list(series)

        current_date = last_date
        for h in range(1, horizon + 1):
            current_date = current_date + pd.Timedelta(days=1)
            dates.append(current_date.strftime("%Y-%m-%d"))

            val = float(hist_list[-28] if len(hist_list) >= 28 else hist_list[-1])
            hist_list.append(val)

            spread = std_dev * np.sqrt(h / 7.0) * 1.28
            p50_preds.append(round(val, 1))
            p10_preds.append(round(max(50.0, val - spread), 1))
            p90_preds.append(round(val + spread, 1))

        return {
            "index": index_name,
            "horizon": horizon,
            "dates": dates,
            "p10": p10_preds,
            "p50": p50_preds,
            "p90": p90_preds,
            "trend": "flat",
            "confidence": 0.50,
            "model_metrics": {
                "seasonal_naive_fallback": True,
                "note": "Pre-trained artifacts missing or loading failed; serving seasonal-naive baseline.",
            },
            "is_fallback": True,
        }

    # ── Lane forecast (Index -> Money) ───────────────────────────────────────

    def forecast_lane(
        self,
        cargo_tonnes: float,
        load_port: dict[str, Any],
        dest_port: dict[str, Any],
        vessel_class: dict[str, Any],
        commodity: str,
        horizon: int = 28,
        db_conn: Any | None = None,
        crude_usd_bbl: float | None = None,
        usd_inr: float | None = None,
        commodity_usd: float | None = None,
    ) -> dict[str, Any]:
        """Project daily freight and landed cost per tonne over the horizon."""
        horizon = max(1, min(horizon, 28))
        sub_index = vessel_class.get("baltic_index", "BDI")

        # 1. Forecast the vessel's sub-index
        index_fc = self.forecast_index(sub_index, horizon=horizon)

        # 2. Distance via Searoute cache
        distance_nm = get_distance(load_port, dest_port, db_conn=db_conn)

        # 3. Exogenous market rates
        if self.merged_df is not None:
            latest_row = self.merged_df.iloc[-1]
            crude = crude_usd_bbl or float(latest_row.get("crude_avg_usd_bbl", 75.0))
            fx = usd_inr or float(latest_row.get("usd_inr", 83.2))

            # Select commodity price based on requested commodity
            if commodity_usd is not None:
                comm_price = commodity_usd
            elif commodity.lower() in ["iron_ore", "ironore", "ore"]:
                comm_price = float(latest_row.get("iron_ore_usd_dmt", 105.0))
            elif commodity.lower() in ["coking_coal", "met_coal", "coal_au"]:
                comm_price = float(latest_row.get("coal_au_usd_mt", 185.0))
            elif commodity.lower() in ["thermal_coal", "coal_sa", "coal"]:
                comm_price = float(latest_row.get("coal_sa_usd_mt", 138.0))
            else:
                comm_price = float(latest_row.get("iron_ore_usd_dmt", 105.0))
        else:
            crude = crude_usd_bbl or 75.0
            fx = usd_inr or 83.2
            comm_price = commodity_usd or 105.0

        dest_port_id = dest_port.get("id", "paradip")

        # 4. Compute cost for each forecast day across p10, p50, p90
        freight_inr_p10: list[float] = []
        freight_inr_p50: list[float] = []
        freight_inr_p90: list[float] = []

        freight_usd_p10: list[float] = []
        freight_usd_p50: list[float] = []
        freight_usd_p90: list[float] = []

        landed_inr_p10: list[float] = []
        landed_inr_p50: list[float] = []
        landed_inr_p90: list[float] = []

        landed_usd_p10: list[float] = []
        landed_usd_p50: list[float] = []
        landed_usd_p90: list[float] = []

        for i in range(horizon):
            idx_p10 = index_fc["p10"][i]
            idx_p50 = index_fc["p50"][i]
            idx_p90 = index_fc["p90"][i]

            cost_p10 = compute_cost(
                cargo_tonnes=cargo_tonnes,
                distance_nm=distance_nm,
                vessel=vessel_class,
                index_value=idx_p10,
                crude_usd_bbl=crude,
                usd_inr=fx,
                commodity_usd_per_unit=comm_price,
                dest_port_id=dest_port_id,
            )["summary"]

            cost_p50 = compute_cost(
                cargo_tonnes=cargo_tonnes,
                distance_nm=distance_nm,
                vessel=vessel_class,
                index_value=idx_p50,
                crude_usd_bbl=crude,
                usd_inr=fx,
                commodity_usd_per_unit=comm_price,
                dest_port_id=dest_port_id,
            )["summary"]

            cost_p90 = compute_cost(
                cargo_tonnes=cargo_tonnes,
                distance_nm=distance_nm,
                vessel=vessel_class,
                index_value=idx_p90,
                crude_usd_bbl=crude,
                usd_inr=fx,
                commodity_usd_per_unit=comm_price,
                dest_port_id=dest_port_id,
            )["summary"]

            freight_inr_p10.append(round(cost_p10["freight_per_tonne_inr"], 2))
            freight_inr_p50.append(round(cost_p50["freight_per_tonne_inr"], 2))
            freight_inr_p90.append(round(cost_p90["freight_per_tonne_inr"], 2))

            freight_usd_p10.append(round(cost_p10["freight_per_tonne_usd"], 2))
            freight_usd_p50.append(round(cost_p50["freight_per_tonne_usd"], 2))
            freight_usd_p90.append(round(cost_p90["freight_per_tonne_usd"], 2))

            landed_inr_p10.append(round(cost_p10["landed_cost_per_tonne_inr"], 2))
            landed_inr_p50.append(round(cost_p50["landed_cost_per_tonne_inr"], 2))
            landed_inr_p90.append(round(cost_p90["landed_cost_per_tonne_inr"], 2))

            landed_usd_p10.append(round(cost_p10["landed_cost_per_tonne_usd"], 2))
            landed_usd_p50.append(round(cost_p50["landed_cost_per_tonne_usd"], 2))
            landed_usd_p90.append(round(cost_p90["landed_cost_per_tonne_usd"], 2))

        return {
            "disclaimer": "estimated (index-derived)",
            "inputs": {
                "cargo_tonnes": cargo_tonnes,
                "load_port": load_port["name"],
                "dest_port": dest_port["name"],
                "vessel_class": vessel_class["class"],
                "commodity": commodity,
                "distance_nm": round(distance_nm, 1),
                "assumed_crude_usd_bbl": round(crude, 2),
                "assumed_usd_inr": round(fx, 2),
                "assumed_commodity_usd": round(comm_price, 2),
            },
            "sub_index": sub_index,
            "horizon": horizon,
            "dates": index_fc["dates"],
            "trend": index_fc["trend"],
            "confidence": index_fc["confidence"],
            "freight_per_tonne_inr": {
                "p10": freight_inr_p10,
                "p50": freight_inr_p50,
                "p90": freight_inr_p90,
            },
            "freight_per_tonne_usd": {
                "p10": freight_usd_p10,
                "p50": freight_usd_p50,
                "p90": freight_usd_p90,
            },
            "landed_cost_per_tonne_inr": {
                "p10": landed_inr_p10,
                "p50": landed_inr_p50,
                "p90": landed_inr_p90,
            },
            "landed_cost_per_tonne_usd": {
                "p10": landed_usd_p10,
                "p50": landed_usd_p50,
                "p90": landed_usd_p90,
            },
            "index_forecast": {
                "p10": index_fc["p10"],
                "p50": index_fc["p50"],
                "p90": index_fc["p90"],
            },
        }


# Singleton service instance
_service: FreightForecastService | None = None


def get_forecast_service() -> FreightForecastService:
    """Return the global FreightForecastService instance."""
    global _service
    if _service is None:
        _service = FreightForecastService()
    return _service
