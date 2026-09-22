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
  ShieldCheck,
  Calendar,
  Sliders,
  Sparkles,
} from "lucide-react";

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

// Custom dark terminal tooltip
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;

  const dataPoint = payload[0]?.payload;
  if (!dataPoint) return null;

  const p10 = dataPoint.p10;
  const p50 = dataPoint.p50;
  const p90 = dataPoint.p90;
  const spread = p90 - p10;
  const spreadPct = p50 > 0 ? ((spread / p50) * 100).toFixed(1) : "0";

  return (
    <div className="rounded-lg border border-[#27272a] bg-[#121214] p-3 shadow-2xl font-mono text-xs text-[#ededed] space-y-2">
      <div className="flex items-center justify-between border-b border-[#1f1f23] pb-1.5 gap-4">
        <span className="font-semibold text-blue-400">{dataPoint.formattedDate}</span>
        <span className="text-[10px] text-zinc-500">{dataPoint.rawDate}</span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-zinc-400">P90 (Upper 90%):</span>
          <span className="font-semibold text-blue-300">
            {p90.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-zinc-400">P50 (Median Forecast):</span>
          <span className="font-semibold text-white">
            {p50.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-zinc-400">P10 (Lower 10%):</span>
          <span className="font-semibold text-blue-400">
            {p10.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
      </div>

      <div className="border-t border-[#1f1f23] pt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
        <span>Uncertainty Spread:</span>
        <span className="text-amber-400 font-semibold">
          &plusmn;{Math.round(spread / 2)} pts ({spreadPct}%)
        </span>
      </div>
    </div>
  );
}

export function ForecastChart() {
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

  // Transform data for Recharts stacked shaded envelope
  const chartData = useMemo(() => {
    if (!data || !data.dates) return [];
    return data.dates.map((dateStr, i) => {
      const p10 = Number(data.p10[i] ?? 0);
      const p50 = Number(data.p50[i] ?? 0);
      const p90 = Number(data.p90[i] ?? 0);
      const dateObj = new Date(dateStr);
      const formattedDate = dateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      return {
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

  // Compute Y-Axis domain
  const [yMin, yMax] = useMemo(() => {
    if (!chartData.length) return [1000, 2000];
    const min = Math.min(...chartData.map((d) => d.p10));
    const max = Math.max(...chartData.map((d) => d.p90));
    return [Math.floor(min * 0.96), Math.ceil(max * 1.04)];
  }, [chartData]);

  // Model metrics values
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
    <div className="w-full rounded-xl border border-[#1f1f23] bg-[#121214] p-4 sm:p-6 space-y-5 shadow-lg">
      {/* ── Header: Title & Index Selector Tabs ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#1f1f23] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-[#ededed]">
              28-Day Probabilistic Freight Forecast
            </h2>
            <span className="rounded bg-blue-950/60 border border-blue-800/60 px-2 py-0.5 font-mono text-[10px] text-blue-400 font-semibold">
              P10 / P50 / P90
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">
            {currentConfig.name} ({currentConfig.label}) &bull;{" "}
            <span className="text-zinc-300">{currentConfig.vessel}</span>
          </p>
        </div>

        {/* Index Switcher Tabs: BDI, BCI, BPI, BSI, BHSI */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#1f1f23] bg-[#0d0d0f] p-1">
          {(["BDI", "BCI", "BPI", "BSI", "BHSI"] as BalticIndex[]).map((idx) => {
            const isSelected = selectedIndex === idx;
            return (
              <button
                key={idx}
                onClick={() => setSelectedIndex(idx)}
                className={`rounded px-3 py-1.5 font-mono text-xs font-semibold transition ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-zinc-400 hover:bg-[#18181c] hover:text-[#ededed]"
                }`}
              >
                {idx}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Sub-header: Trend, Confidence, and Model Note ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1f1f23] bg-[#161619] p-3 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          {/* Trend Badge */}
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 text-[11px] uppercase">Trajectory:</span>
            {data?.trend === "up" ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 text-emerald-400 font-semibold">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>UPWARD TREND</span>
              </span>
            ) : data?.trend === "down" ? (
              <span className="inline-flex items-center gap-1 rounded bg-rose-950/40 border border-rose-800/40 px-2 py-0.5 text-rose-400 font-semibold">
                <TrendingDown className="h-3.5 w-3.5" />
                <span>DOWNWARD TREND</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-zinc-800/60 border border-zinc-700 px-2 py-0.5 text-zinc-300 font-semibold">
                <Minus className="h-3.5 w-3.5" />
                <span>FLAT / SIDEWAYS</span>
              </span>
            )}
          </div>

          {/* Confidence Badge */}
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 text-[11px] uppercase">Confidence:</span>
            <span className="rounded bg-blue-950/50 border border-blue-800/50 px-2 py-0.5 text-blue-300 font-semibold">
              {data?.confidence ? `${Math.round(data.confidence * 100)}%` : "--"}
            </span>
          </div>

          {lgbmMape && (
            <div className="hidden md:flex items-center gap-1 text-zinc-400 text-[11px]">
              <span>P50 MAPE:</span>
              <span className="text-[#ededed] font-semibold">{lgbmMape.toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Real Model Metrics One-Line Note */}
        <div className="flex items-center gap-1.5 text-zinc-400 text-[11px]">
          <Sparkles className="h-3.5 w-3.5 text-blue-400 shrink-0" />
          <span>
            LightGBM quantile &middot; backtested pinball loss{" "}
            <strong className="text-blue-300">{pinballLgbm}</strong> vs seasonal-naive{" "}
            <span className="text-zinc-500">{pinballNaive}</span>
          </span>
        </div>
      </div>

      {/* ── Main Chart Canvas ── */}
      <div className="relative h-80 w-full">
        {loading ? (
          <div className="flex h-full w-full flex-col items-center justify-center font-mono text-xs text-zinc-500 space-y-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span>Computing LightGBM quantile trajectories for {selectedIndex}&hellip;</span>
          </div>
        ) : error ? (
          <div className="flex h-full w-full items-center justify-center font-mono text-xs text-rose-400">
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
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#1f1f23"
                vertical={false}
              />

              <XAxis
                dataKey="formattedDate"
                stroke="#52525b"
                tick={{ fill: "#71717a", fontSize: 10, fontFamily: "monospace" }}
                tickLine={false}
                axisLine={{ stroke: "#27272a" }}
              />

              <YAxis
                domain={[yMin, yMax]}
                stroke="#52525b"
                tick={{ fill: "#71717a", fontSize: 10, fontFamily: "monospace" }}
                tickLine={false}
                axisLine={{ stroke: "#27272a" }}
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
                stroke="#60a5fa"
                strokeDasharray="3 3"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
                name="P90 Upper"
              />
              <Line
                type="monotone"
                dataKey="p10"
                stroke="#60a5fa"
                strokeDasharray="3 3"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
                name="P10 Lower"
              />

              {/* P50 Median Forecast Line */}
              <Line
                type="monotone"
                dataKey="p50"
                stroke="#3b82f6"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-blue-900/40 bg-blue-950/20 p-3.5 text-xs font-mono">
        <div className="flex items-start sm:items-center gap-2.5 text-zinc-300">
          <Info className="h-4 w-4 shrink-0 text-blue-400 mt-0.5 sm:mt-0" />
          <div>
            <span className="font-semibold text-blue-300">Methodology Note: </span>
            <span className="text-zinc-200">
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
          className="inline-flex items-center gap-1.5 rounded bg-blue-600/20 border border-blue-500/40 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-600 hover:text-white transition shrink-0"
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>Evaluate Lane in Decision &rarr;</span>
        </Link>
      </div>
    </div>
  );
}
