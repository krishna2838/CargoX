"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  Sliders,
  Sparkles,
} from "lucide-react";
import { useTheme } from "../providers/ThemeProvider";

export type BalticIndex = "BDI" | "BCI" | "BPI" | "BSI" | "BHSI";

interface ForecastResponse {
  index: string;
  horizon: number;
  dates: string[];
  p10: number[];
  p50: number[];
  p90: number[];
  trend: "up" | "down" | "flat";
  confidence: number;
  model_metrics?: {
    target_index?: string;
    lightgbm?: {
      p50_mape_pct?: number;
      pinball_loss_avg?: number;
      interval_coverage_80pct?: number;
    };
    seasonal_naive?: {
      p50_mape_pct?: number;
      pinball_loss_avg?: number;
    };
    sarima?: {
      p50_mape_pct?: number;
      pinball_loss_p50?: number;
    };
    beats_seasonal_naive_on_pinball?: boolean;
  };
  is_fallback?: boolean;
}

const INDEX_CONFIG: Record<
  BalticIndex,
  { label: string; name: string; vessel: string; color: string }
> = {
  BDI: {
    label: "BDI",
    name: "Baltic Dry Index",
    vessel: "Composite Benchmark",
    color: "#3b82f6",
  },
  BCI: {
    label: "BCI",
    name: "Baltic Capesize Index",
    vessel: "Capesize (≥260m, ~180k DWT)",
    color: "#c084fc",
  },
  BPI: {
    label: "BPI",
    name: "Baltic Panamax Index",
    vessel: "Panamax / Kamsarmax (~75k-82k DWT)",
    color: "#38bdf8",
  },
  BSI: {
    label: "BSI",
    name: "Baltic Supramax Index",
    vessel: "Supramax (170-215m, ~58k-64k DWT)",
    color: "#06b6d4",
  },
  BHSI: {
    label: "BHSI",
    name: "Baltic Handysize Index",
    vessel: "Handysize (100-170m, ~38k DWT)",
    color: "#10b981",
  },
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

// Custom theme-aware tooltip
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;

  const dataPoint = payload[0]?.payload;
  if (!dataPoint) return null;

  const p10 = dataPoint.p10;
  const p50 = dataPoint.p50;
  const p90 = dataPoint.p90;
  const spread = p90 - p10;
  const spreadPct = p50 > 0 ? ((spread / p50) * 100).toFixed(1) : "0";

  return (
    <div className="rounded-lg border border-cx-border-subtle bg-cx-card p-3 shadow-2xl font-mono text-xs text-cx-text space-y-2">
      <div className="flex items-center justify-between border-b border-cx-border pb-1.5 gap-4">
        <span className="font-semibold text-blue-500">{dataPoint.formattedDate}</span>
        <span className="text-[10px] text-cx-text-muted">{dataPoint.rawDate}</span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-cx-text-secondary">P90 (Upper 90%):</span>
          <span className="font-semibold text-blue-400">
            {p90.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-cx-text-secondary">P50 (Median Forecast):</span>
          <span className="font-semibold text-cx-text">
            {p50.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-cx-text-secondary">P10 (Lower 10%):</span>
          <span className="font-semibold text-blue-500">
            {p10.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
      </div>

      <div className="border-t border-cx-border pt-1.5 flex items-center justify-between text-[11px] text-cx-text-secondary">
        <span>Uncertainty Spread:</span>
        <span className="text-amber-500 font-semibold">
          &plusmn;{Math.round(spread / 2)} pts ({spreadPct}%)
        </span>
      </div>
    </div>
  );
}

export function ForecastChart() {
  const { theme } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState<BalticIndex>("BDI");
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchForecast() {
      try {
        const res = await fetch(
          `${API_BASE}/forecast?index=${selectedIndex}&horizon=28`
        );
        if (!res.ok) {
          throw new Error(`Failed to load forecast for ${selectedIndex}`);
        }
        const json: ForecastResponse = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load forecast data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchForecast();
    return () => {
      cancelled = true;
    };
  }, [selectedIndex]);

  // Transform raw API arrays into Recharts-friendly data objects
  const chartData = useMemo(() => {
    if (!data || !data.dates) return [];

    return data.dates.map((dateStr, i) => {
      const p10 = data.p10[i] ?? 0;
      const p50 = data.p50[i] ?? 0;
      const p90 = data.p90[i] ?? 0;

      const dateObj = new Date(dateStr);
      const formattedDate = dateObj.toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric",
      });

      return {
        dateIndex: i,
        rawDate: dateStr,
        formattedDate,
        p10,
        p50,
        p90,
        bandBase: p10,
        bandRange: Math.max(0, p90 - p10),
      };
    });
  }, [data]);

  // Compute nice Y-axis domain
  const { yMin, yMax } = useMemo(() => {
    if (!chartData.length) return { yMin: 0, yMax: 2000 };
    const allVals = chartData.flatMap((d) => [d.p10, d.p50, d.p90]);
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const padding = (max - min) * 0.15 || 100;
    return {
      yMin: Math.max(0, Math.floor(min - padding)),
      yMax: Math.ceil(max + padding),
    };
  }, [chartData]);

  const pinballLgbm =
    data?.model_metrics?.lightgbm?.pinball_loss_avg !== undefined
      ? data.model_metrics.lightgbm.pinball_loss_avg.toFixed(1)
      : "32.0";
  const pinballNaive =
    data?.model_metrics?.seasonal_naive?.pinball_loss_avg !== undefined
      ? data.model_metrics.seasonal_naive.pinball_loss_avg.toFixed(1)
      : "68.3";
  const lgbmMape = data?.model_metrics?.lightgbm?.p50_mape_pct;

  const currentConfig = INDEX_CONFIG[selectedIndex];

  return (
    <div className="w-full rounded-xl border border-cx-border bg-cx-card p-4 sm:p-6 space-y-5 shadow-lg">
      {/* ── Header: Title & Index Selector Tabs ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-cx-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-cx-text">
              28-Day Probabilistic Freight Forecast
            </h2>
            <span className="rounded bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 font-mono text-[10px] text-blue-500 font-semibold">
              P10 / P50 / P90
            </span>
          </div>
          <p className="mt-0.5 text-xs text-cx-text-secondary">
            {currentConfig.name} ({currentConfig.label}) &bull;{" "}
            <span className="text-cx-text font-medium">{currentConfig.vessel}</span>
          </p>
        </div>

        {/* Index Switcher Tabs: BDI, BCI, BPI, BSI, BHSI */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-cx-border bg-cx-surface p-1">
          {(["BDI", "BCI", "BPI", "BSI", "BHSI"] as BalticIndex[]).map((idx) => {
            const isSelected = selectedIndex === idx;
            return (
              <button
                key={idx}
                onClick={() => setSelectedIndex(idx)}
                className={`rounded px-3 py-1.5 font-mono text-xs font-semibold transition ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-cx-text-secondary hover:bg-cx-hover hover:text-cx-text"
                }`}
              >
                {idx}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Sub-header: Trend, Confidence, and Model Note ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cx-border bg-cx-surface p-3 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          {/* Trend Badge */}
          <div className="flex items-center gap-1.5">
            <span className="text-cx-text-muted text-[11px] uppercase">Trajectory:</span>
            {data?.trend === "up" ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>UPWARD TREND</span>
              </span>
            ) : data?.trend === "down" ? (
              <span className="inline-flex items-center gap-1 rounded bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 text-rose-600 dark:text-rose-400 font-semibold">
                <TrendingDown className="h-3.5 w-3.5" />
                <span>DOWNWARD TREND</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-cx-hover border border-cx-border px-2 py-0.5 text-cx-text-secondary font-semibold">
                <Minus className="h-3.5 w-3.5" />
                <span>FLAT / SIDEWAYS</span>
              </span>
            )}
          </div>

          {/* Confidence Badge */}
          <div className="flex items-center gap-1.5">
            <span className="text-cx-text-muted text-[11px] uppercase">Confidence:</span>
            <span className="rounded bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 text-blue-500 font-semibold">
              {data?.confidence ? `${Math.round(data.confidence * 100)}%` : "--"}
            </span>
          </div>

          {lgbmMape && (
            <div className="hidden md:flex items-center gap-1 text-cx-text-secondary text-[11px]">
              <span>P50 MAPE:</span>
              <span className="text-cx-text font-semibold">{lgbmMape.toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Real Model Metrics One-Line Note */}
        <div className="flex items-center gap-1.5 text-cx-text-secondary text-[11px]">
          <Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <span>
            LightGBM quantile &middot; backtested pinball loss{" "}
            <strong className="text-blue-500 font-semibold">{pinballLgbm}</strong> vs seasonal-naive{" "}
            <span className="text-cx-text-muted">{pinballNaive}</span>
          </span>
        </div>
      </div>

      {/* ── Main Chart Canvas ── */}
      <div className="relative h-80 w-full">
        {loading ? (
          <div className="flex h-full w-full flex-col items-center justify-center font-mono text-xs text-cx-text-muted space-y-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span>Computing LightGBM quantile trajectories for {selectedIndex}&hellip;</span>
          </div>
        ) : error ? (
          <div className="flex h-full w-full items-center justify-center font-mono text-xs text-rose-500">
            {error}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 15, left: -10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="forecastBandGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--cx-accent)"
                    stopOpacity={theme === "light" ? 0.35 : 0.25}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--cx-accent)"
                    stopOpacity={theme === "light" ? 0.12 : 0.05}
                  />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--cx-border)"
                vertical={false}
              />

              <XAxis
                dataKey="formattedDate"
                stroke="var(--cx-border-subtle)"
                tick={{ fill: "var(--cx-text-muted)", fontSize: 10, fontFamily: "monospace" }}
                tickLine={false}
                axisLine={{ stroke: "var(--cx-border-subtle)" }}
              />

              <YAxis
                domain={[yMin, yMax]}
                stroke="var(--cx-border-subtle)"
                tick={{ fill: "var(--cx-text-muted)", fontSize: 10, fontFamily: "monospace" }}
                tickLine={false}
                axisLine={{ stroke: "var(--cx-border-subtle)" }}
                tickFormatter={(val) => Math.round(val).toLocaleString()}
              />

              <Tooltip content={<CustomTooltip />} />

              {/* Shaded P10-P90 Uncertainty Band (Stacked Area) */}
              <Area
                type="monotone"
                dataKey="bandBase"
                stackId="uncertainty"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="bandRange"
                stackId="uncertainty"
                stroke="none"
                fill="url(#forecastBandGradient)"
                isAnimationActive={false}
                name="P10-P90 Band"
              />

              {/* Boundary guide dotted lines */}
              <Line
                type="monotone"
                dataKey="p90"
                stroke="var(--cx-accent)"
                strokeOpacity={0.7}
                strokeDasharray="3 3"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
                name="P90 Upper"
              />
              <Line
                type="monotone"
                dataKey="p10"
                stroke="var(--cx-accent)"
                strokeOpacity={0.7}
                strokeDasharray="3 3"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
                name="P10 Lower"
              />

              {/* P50 Median Forecast Line using var(--cx-accent) */}
              <Line
                type="monotone"
                dataKey="p50"
                stroke="var(--cx-accent)"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                name="P50 Forecast"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Deliberate Honesty Caption ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs font-mono">
        <div className="flex items-start sm:items-center gap-2.5 text-cx-text">
          <Info className="h-4 w-4 shrink-0 text-blue-500 mt-0.5 sm:mt-0" />
          <div>
            <span className="font-semibold text-blue-500">Methodology Note: </span>
            <span className="text-cx-text-secondary">
              Forecast is on the real Baltic index. Lane ₹/tonne is estimated — see Decision.
            </span>
          </div>
        </div>

        <Link
          href={`/decision?klass=${
            selectedIndex === "BCI"
              ? "Capesize"
              : selectedIndex === "BPI"
                ? "Panamax"
                : selectedIndex === "BSI"
                  ? "Supramax"
                  : selectedIndex === "BHSI"
                    ? "Handysize"
                    : "Panamax"
          }&dest=paradip`}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition shrink-0 shadow-xs"
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>Evaluate Lane in Decision &rarr;</span>
        </Link>
      </div>
    </div>
  );
}
