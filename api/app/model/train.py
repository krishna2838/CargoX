"""Freight index forecasting model training script.

Trains LightGBM quantile regression models (alpha = 0.1, 0.5, 0.9) to forecast
Baltic Exchange dry bulk indices (BDI, BCI, BPI, BSI, BHSI) over a 28-day horizon.
Uses a recursive one-step autoregressive model with empirical residual quantiles
derived from walk-forward backtesting.

NOTE:
  For the Smart India Hackathon (SIH) demo, model training is an offline,
  one-time step. The trained models ship with committed artifacts in
  api/app/model/artifacts/. No background retraining infrastructure is required
  at runtime, but this script is fully re-runnable whenever fresh Baltic Exchange
  or Pink Sheet history is provided.

Exogenous features note:
  Exogenous features are lagged by one period to prevent look-ahead bias
  (implemented in app.model.features).

Usage:
  python -m app.model.train --quick
  python -m app.model.train --indices BDI,BCI,BPI,BSI,BHSI
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import logging
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from statsmodels.tsa.statespace.sarimax import SARIMAX

from app.model.features import (
    FEATURE_COLS,
    build_feature_dataframe,
    build_merged_dataset,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
)
log = logging.getLogger("train")

# Default artifact directory
_APP_DIR = Path(__file__).resolve().parent.parent
DEFAULT_ARTIFACTS_DIR = _APP_DIR / "model" / "artifacts"


# ---------------------------------------------------------------------------
# Loss metrics
# ---------------------------------------------------------------------------

def pinball_loss(y_true: np.ndarray, y_pred: np.ndarray, alpha: float) -> float:
    """Compute pinball (quantile) loss for quantile alpha."""
    diff = y_true - y_pred
    return float(np.mean(np.maximum(alpha * diff, (alpha - 1.0) * diff)))


def mean_absolute_percentage_error(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Compute MAPE as a percentage."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = y_true != 0
    if not np.any(mask):
        return 0.0
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100.0)


# ---------------------------------------------------------------------------
# Recursive forecasting simulation
# ---------------------------------------------------------------------------

def recursive_forecast(
    model_p50: LGBMRegressor,
    history_df: pd.DataFrame,
    target_index: str,
    horizon: int = 28,
) -> tuple[list[float], list[str]]:
    """Generate recursive 28-day median forecast from history_df.

    At each step k in 1..horizon:
      - Construct the feature row using the latest history + past predictions.
      - Predict the next day's index value.
      - Append the prediction into history so subsequent lags and rolling stats update.
    """
    sim_df = history_df[["date", target_index] + [c for c in history_df.columns if c in [
        "crude_avg_usd_bbl", "iron_ore_usd_dmt", "coal_au_usd_mt", "coal_sa_usd_mt", "usd_inr"
    ]]].copy()

    last_date = sim_df["date"].iloc[-1]
    last_crude = sim_df["crude_avg_usd_bbl"].iloc[-1]
    last_ore = sim_df["iron_ore_usd_dmt"].iloc[-1]
    last_coal_au = sim_df["coal_au_usd_mt"].iloc[-1]
    last_coal_sa = sim_df["coal_sa_usd_mt"].iloc[-1]
    last_fx = sim_df["usd_inr"].iloc[-1]

    preds: list[float] = []
    forecast_dates: list[str] = []

    current_date = last_date
    for h in range(1, horizon + 1):
        # Step calendar day (skip or keep business/calendar day)
        current_date = current_date + pd.Timedelta(days=1)
        forecast_dates.append(current_date.strftime("%Y-%m-%d"))

        series = sim_df[target_index].values
        n = len(series)

        lag_1 = float(series[-1])
        lag_7 = float(series[-7]) if n >= 7 else lag_1
        lag_14 = float(series[-14]) if n >= 14 else lag_1
        lag_28 = float(series[-28]) if n >= 28 else lag_1

        rolling_7 = float(np.mean(series[-7:])) if n >= 7 else lag_1
        rolling_7_std = float(np.std(series[-7:])) if n >= 7 else 0.0
        rolling_28 = float(np.mean(series[-28:])) if n >= 28 else lag_1
        rolling_28_std = float(np.std(series[-28:])) if n >= 28 else 0.0

        target_7d_chg = lag_1 - lag_7
        target_28d_chg = lag_1 - lag_28

        day_of_week = current_date.dayofweek
        week_of_year = int(current_date.isocalendar()[1])
        month = current_date.month

        # Exogenous carried forward
        crude_7d_chg = 0.0
        iron_ore_7d_chg = 0.0
        coal_au_7d_chg = 0.0
        usd_inr_7d_chg = 0.0

        feat_row = pd.DataFrame([{
            "lag_1": lag_1,
            "lag_7": lag_7,
            "lag_14": lag_14,
            "lag_28": lag_28,
            "rolling_mean_7": rolling_7,
            "rolling_std_7": rolling_7_std,
            "rolling_mean_28": rolling_28,
            "rolling_std_28": rolling_28_std,
            "target_7d_chg": target_7d_chg,
            "target_28d_chg": target_28d_chg,
            "day_of_week": day_of_week,
            "week_of_year": week_of_year,
            "month": month,
            "crude_avg_usd_bbl": last_crude,
            "iron_ore_usd_dmt": last_ore,
            "coal_au_usd_mt": last_coal_au,
            "coal_sa_usd_mt": last_coal_sa,
            "usd_inr": last_fx,
            "crude_7d_chg": crude_7d_chg,
            "iron_ore_7d_chg": iron_ore_7d_chg,
            "coal_au_7d_chg": coal_au_7d_chg,
            "usd_inr_7d_chg": usd_inr_7d_chg,
        }])[FEATURE_COLS]

        p50_val = float(model_p50.predict(feat_row)[0])
        preds.append(p50_val)

        # Append prediction to sim_df for next recursive step
        new_row = {
            "date": current_date,
            target_index: p50_val,
            "crude_avg_usd_bbl": last_crude,
            "iron_ore_usd_dmt": last_ore,
            "coal_au_usd_mt": last_coal_au,
            "coal_sa_usd_mt": last_coal_sa,
            "usd_inr": last_fx,
        }
        sim_df = pd.concat([sim_df, pd.DataFrame([new_row])], ignore_index=True)

    return preds, forecast_dates


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------

def seasonal_naive_forecast(history_series: np.ndarray, horizon: int = 28) -> np.ndarray:
    """Seasonal naive baseline: persists values from 28 days prior."""
    preds = []
    hist = list(history_series)
    for _ in range(horizon):
        val = hist[-28] if len(hist) >= 28 else hist[-1]
        preds.append(val)
        hist.append(val)
    return np.array(preds, dtype=float)


def fit_sarima_with_timeout(
    history_series: np.ndarray,
    horizon: int = 28,
    timeout_secs: int = 60,
) -> tuple[np.ndarray | None, str]:
    """Fit a SARIMAX(1, 1, 1) model with strict timeout protection (max 60s).

    Returns (forecast_array or None, status_message).
    """
    def _run() -> np.ndarray:
        # Use simple ARIMA(1, 1, 1) which converges much faster than seasonal
        mod = SARIMAX(
            history_series,
            order=(1, 1, 1),
            enforce_stationarity=False,
            enforce_invertibility=False,
        )
        res = mod.fit(disp=False, maxiter=40)
        return np.array(res.forecast(steps=horizon), dtype=float)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_run)
        try:
            forecast = future.result(timeout=timeout_secs)
            return forecast, "ok"
        except concurrent.futures.TimeoutError:
            log.warning("SARIMA fit timed out after %ds — skipping SARIMA for this fold.", timeout_secs)
            return None, "timed out after 60s"
        except Exception as exc:
            log.warning("SARIMA fit failed: %s", exc)
            return None, f"failed: {exc}"


# ---------------------------------------------------------------------------
# Walk-forward backtest & trainer
# ---------------------------------------------------------------------------

def train_and_backtest_index(
    merged_df: pd.DataFrame,
    target_index: str = "BDI",
    quick: bool = False,
    horizon: int = 28,
) -> dict[str, Any]:
    """Train LightGBM quantiles and evaluate via walk-forward expanding window."""
    log.info("=" * 65)
    log.info("Training freight forecasting model for index: %s (quick=%s)", target_index, quick)
    log.info("=" * 65)

    feat_df = build_feature_dataframe(merged_df, target_index=target_index)
    total_samples = len(feat_df)
    log.info("Prepared %d feature rows with %d columns", total_samples, len(FEATURE_COLS))

    # Define walk-forward backtest origins
    # Leave at least 300 days for initial training
    min_train = 320
    test_span = total_samples - min_train - horizon

    if test_span <= 0:
        raise ValueError(f"Insufficient history ({total_samples} rows) for {min_train} train + {horizon} test")

    if quick:
        # 3 folds
        step_size = max(test_span // 3, 14)
        fold_origins = [min_train + i * step_size for i in range(3) if min_train + i * step_size + horizon <= total_samples]
    else:
        # Expanding window across test span (targeting 12-15 representative market cycles)
        n_folds = min(12, max(5, test_span // 60))
        step_size = max(test_span // n_folds, 21)
        fold_origins = list(range(min_train, total_samples - horizon + 1, step_size))[-n_folds:]

    if not fold_origins:
        fold_origins = [total_samples - horizon]

    log.info("Walk-forward evaluation with %d expanding folds", len(fold_origins))

    lgb_residuals: list[list[float]] = [[] for _ in range(horizon)]  # residuals per horizon step h=1..28
    lgb_preds_all: list[float] = []
    lgb_y_all: list[float] = []

    naive_preds_all: list[float] = []
    naive_residuals: list[list[float]] = [[] for _ in range(horizon)]

    sarima_preds_all: list[float] = []
    sarima_y_all: list[float] = []
    sarima_status = "not evaluated"

    # Evaluate walk-forward folds
    for fold_idx, origin in enumerate(fold_origins):
        train_slice = feat_df.iloc[:origin]
        X_tr = train_slice[FEATURE_COLS]
        y_tr = train_slice["target"]

        # Train 1-step P50 LightGBM regressor on expanding window
        m_p50 = LGBMRegressor(
            objective="quantile",
            alpha=0.5,
            n_estimators=100,
            learning_rate=0.05,
            num_leaves=15,
            min_child_samples=10,
            random_state=42,
            verbose=-1,
            n_jobs=-1,
        )
        m_p50.fit(X_tr, y_tr)

        # Generate 28-day recursive forecast
        raw_history = merged_df.iloc[:origin + 28]  # include offset for lags
        preds_p50, _ = recursive_forecast(m_p50, raw_history, target_index, horizon=horizon)

        # Ground truth for next 28 days
        actuals = feat_df["target"].iloc[origin: origin + horizon].values
        actual_len = len(actuals)

        for h in range(actual_len):
            res = float(actuals[h] - preds_p50[h])
            lgb_residuals[h].append(res)
            lgb_preds_all.append(preds_p50[h])
            lgb_y_all.append(actuals[h])

        # Seasonal Naive baseline
        hist_vals = merged_df[target_index].iloc[:origin].values
        naive_forecast = seasonal_naive_forecast(hist_vals, horizon=actual_len)
        for h in range(actual_len):
            naive_preds_all.append(naive_forecast[h])
            naive_residuals[h].append(float(actuals[h] - naive_forecast[h]))

        # SARIMA baseline (test on latest fold to save time and verify)
        if fold_idx == len(fold_origins) - 1:
            sarima_fc, s_status = fit_sarima_with_timeout(hist_vals, horizon=actual_len, timeout_secs=60)
            sarima_status = s_status
            if sarima_fc is not None:
                sarima_preds_all.extend(list(sarima_fc))
                sarima_y_all.extend(list(actuals))

    # Calculate empirical residual quantiles per horizon h=1..28 for LightGBM
    q10_offsets: list[float] = []
    q90_offsets: list[float] = []
    for h in range(horizon):
        res_h = lgb_residuals[h] if lgb_residuals[h] else [0.0]
        q10 = float(np.percentile(res_h, 10))
        q90 = float(np.percentile(res_h, 90))
        q10_offsets.append(q10)
        q90_offsets.append(q90)

    # Compute walk-forward metrics
    y_true_arr = np.array(lgb_y_all, dtype=float)
    p50_pred_arr = np.array(lgb_preds_all, dtype=float)

    # Reconstruct P10 and P90 predictions across backtest
    p10_pred_arr = []
    p90_pred_arr = []
    step = 0
    for _ in range(len(fold_origins)):
        for h in range(horizon):
            if step < len(p50_pred_arr):
                p10_pred_arr.append(p50_pred_arr[step] + q10_offsets[h])
                p90_pred_arr.append(p50_pred_arr[step] + q90_offsets[h])
                step += 1

    p10_pred_arr = np.minimum(np.array(p10_pred_arr), p50_pred_arr)
    p90_pred_arr = np.maximum(np.array(p90_pred_arr), p50_pred_arr)

    lgb_pinball_10 = pinball_loss(y_true_arr, p10_pred_arr, 0.1)
    lgb_pinball_50 = pinball_loss(y_true_arr, p50_pred_arr, 0.5)
    lgb_pinball_90 = pinball_loss(y_true_arr, p90_pred_arr, 0.9)
    lgb_pinball_avg = (lgb_pinball_10 + lgb_pinball_50 + lgb_pinball_90) / 3.0
    lgb_mape = mean_absolute_percentage_error(y_true_arr, p50_pred_arr)

    # Coverage of [P10, P90]
    covered = np.logical_and(y_true_arr >= p10_pred_arr, y_true_arr <= p90_pred_arr)
    coverage = float(np.mean(covered)) if len(covered) > 0 else 0.8

    # Apply coverage-calibration multiplier: if observed coverage < 0.80, scale offsets
    if coverage < 0.80 and coverage > 0.0:
        multiplier = min(1.5, 0.80 / coverage)
        log.info(
            "Calibrating prediction intervals for %s: observed coverage %.1f%% < 80%% -> scaling offsets by %.3fx",
            target_index, coverage * 100.0, multiplier
        )
        q10_offsets = [float(q * multiplier) for q in q10_offsets]
        q90_offsets = [float(q * multiplier) for q in q90_offsets]

        # Recalculate P10/P90 backtest arrays and metrics with calibrated offsets
        p10_pred_arr_calib = []
        p90_pred_arr_calib = []
        step = 0
        for _ in range(len(fold_origins)):
            for h in range(horizon):
                if step < len(p50_pred_arr):
                    p10_pred_arr_calib.append(p50_pred_arr[step] + q10_offsets[h])
                    p90_pred_arr_calib.append(p50_pred_arr[step] + q90_offsets[h])
                    step += 1

        p10_pred_arr = np.minimum(np.array(p10_pred_arr_calib), p50_pred_arr)
        p90_pred_arr = np.maximum(np.array(p90_pred_arr_calib), p50_pred_arr)
        covered = np.logical_and(y_true_arr >= p10_pred_arr, y_true_arr <= p90_pred_arr)
        coverage = float(np.mean(covered)) if len(covered) > 0 else 0.8
        lgb_pinball_10 = pinball_loss(y_true_arr, p10_pred_arr, 0.1)
        lgb_pinball_90 = pinball_loss(y_true_arr, p90_pred_arr, 0.9)
        lgb_pinball_avg = (lgb_pinball_10 + lgb_pinball_50 + lgb_pinball_90) / 3.0

    # Baseline metrics
    naive_pred_arr = np.array(naive_preds_all, dtype=float)
    naive_mape = mean_absolute_percentage_error(y_true_arr, naive_pred_arr)
    # Naive quantiles based on training residual std
    naive_std = float(np.std([r for sub in naive_residuals for r in sub])) if naive_residuals else 100.0
    naive_p10 = naive_pred_arr - 1.282 * naive_std
    naive_p90 = naive_pred_arr + 1.282 * naive_std
    naive_pinball_10 = pinball_loss(y_true_arr, naive_p10, 0.1)
    naive_pinball_50 = pinball_loss(y_true_arr, naive_pred_arr, 0.5)
    naive_pinball_90 = pinball_loss(y_true_arr, naive_p90, 0.9)
    naive_pinball_avg = (naive_pinball_10 + naive_pinball_50 + naive_pinball_90) / 3.0

    # SARIMA metrics
    if sarima_preds_all and len(sarima_preds_all) == len(sarima_y_all):
        s_y = np.array(sarima_y_all, dtype=float)
        s_p = np.array(sarima_preds_all, dtype=float)
        sarima_mape = mean_absolute_percentage_error(s_y, s_p)
        sarima_pinball_50 = pinball_loss(s_y, s_p, 0.5)
    else:
        sarima_mape = None
        sarima_pinball_50 = None

    beats_naive = lgb_pinball_avg <= naive_pinball_avg

    metrics = {
        "target_index": target_index,
        "n_samples": total_samples,
        "n_folds": len(fold_origins),
        "horizon_days": horizon,
        "lightgbm": {
            "p50_mape_pct": round(lgb_mape, 2),
            "pinball_loss_p10": round(lgb_pinball_10, 2),
            "pinball_loss_p50": round(lgb_pinball_50, 2),
            "pinball_loss_p90": round(lgb_pinball_90, 2),
            "pinball_loss_avg": round(lgb_pinball_avg, 2),
            "interval_coverage_80pct": round(coverage * 100.0, 1),
        },
        "seasonal_naive": {
            "p50_mape_pct": round(naive_mape, 2),
            "pinball_loss_avg": round(naive_pinball_avg, 2),
        },
        "sarima": {
            "status": sarima_status,
            "p50_mape_pct": round(sarima_mape, 2) if sarima_mape is not None else None,
            "pinball_loss_p50": round(sarima_pinball_50, 2) if sarima_pinball_50 is not None else None,
        },
        "beats_seasonal_naive_on_pinball": beats_naive,
    }

    log.info(
        "Results for %s -> LightGBM MAPE: %.2f%% (Naive: %.2f%%) | Pinball: %.2f (Naive: %.2f) | Beats Naive: %s",
        target_index, lgb_mape, naive_mape, lgb_pinball_avg, naive_pinball_avg, beats_naive,
    )

    # ── Final Full Retrain ───────────────────────────────────────────────
    # Fit final LightGBM models on 100% of historical data
    X_full = feat_df[FEATURE_COLS]
    y_full = feat_df["target"]

    log.info("Fitting final production models on full history (%d rows)...", len(X_full))
    final_models: dict[str, LGBMRegressor] = {}
    for alpha in [0.1, 0.5, 0.9]:
        reg = LGBMRegressor(
            objective="quantile",
            alpha=alpha,
            n_estimators=120,
            learning_rate=0.05,
            num_leaves=15,
            min_child_samples=10,
            random_state=42,
            verbose=-1,
            n_jobs=-1,
        )
        reg.fit(X_full, y_full)
        final_models[f"p{int(alpha * 100)}"] = reg

    metadata = {
        "target_index": target_index,
        "trained_date_max": str(merged_df["date"].max()),
        "trained_date_min": str(merged_df["date"].min()),
        "horizon": horizon,
        "feature_cols": FEATURE_COLS,
        "q10_offsets": [round(float(q), 3) for q in q10_offsets],
        "q90_offsets": [round(float(q), 3) for q in q90_offsets],
        "metrics": metrics,
    }

    return {
        "models": final_models,
        "metadata": metadata,
        "metrics": metrics,
    }


def save_index_artifacts(
    target_index: str,
    trained_pack: dict[str, Any],
    artifacts_dir: Path,
) -> None:
    """Save trained models and metadata to artifacts directory."""
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    models = trained_pack["models"]
    metadata = trained_pack["metadata"]

    for key, model in models.items():
        model_file = artifacts_dir / f"{target_index}_model_{key}.joblib"
        joblib.dump(model, model_file)
        log.info("Saved model artifact: %s", model_file.name)

    meta_file = artifacts_dir / f"{target_index}_meta.json"
    with open(meta_file, "w") as f:
        json.dump(metadata, f, indent=2)
    log.info("Saved metadata artifact: %s", meta_file.name)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train CargoX freight forecasting models.")
    parser.add_argument(
        "--indices",
        type=str,
        default="BDI",
        help="Comma-separated list of indices to train, e.g. BDI or BDI,BCI,BPI,BSI,BHSI",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Fast training mode (only 3 backtest folds) for rapid development.",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(DEFAULT_ARTIFACTS_DIR),
        help="Directory to save model artifacts and metrics.json",
    )
    args = parser.parse_args()

    artifacts_dir = Path(args.output_dir)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    target_indices = [idx.strip().upper() for idx in args.indices.split(",") if idx.strip()]
    if args.quick and len(target_indices) > 1 and "BDI" in target_indices:
        # If user passed quick with multiple indices, focus on BDI as requested
        target_indices = ["BDI"]

    log.info("Loading and merging data sources...")
    merged_df = build_merged_dataset()

    all_metrics: dict[str, Any] = {}

    for idx_name in target_indices:
        trained_pack = train_and_backtest_index(
            merged_df=merged_df,
            target_index=idx_name,
            quick=args.quick,
            horizon=28,
        )
        save_index_artifacts(idx_name, trained_pack, artifacts_dir)
        all_metrics[idx_name] = trained_pack["metrics"]

    # Save summary metrics.json
    metrics_file = artifacts_dir / "metrics.json"
    with open(metrics_file, "w") as f:
        json.dump(all_metrics, f, indent=2)
    log.info("Saved summary metrics: %s", metrics_file)

    log.info("\n" + "=" * 70)
    log.info("TRAINING SUMMARY & BENCHMARK")
    log.info("=" * 70)
    for idx_name, m in all_metrics.items():
        log.info(
            "Index: %-5s | LightGBM MAPE: %5.2f%% | Naive MAPE: %5.2f%% | Beats Naive: %s",
            idx_name,
            m["lightgbm"]["p50_mape_pct"],
            m["seasonal_naive"]["p50_mape_pct"],
            "YES" if m["beats_seasonal_naive_on_pinball"] else "NO",
        )
    log.info("=" * 70)


if __name__ == "__main__":
    main()
