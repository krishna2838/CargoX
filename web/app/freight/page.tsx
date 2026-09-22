"use client";

import React, { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/ui/StatCard";
import { CommoditiesStrip } from "@/components/freight/CommoditiesStrip";
import { ForecastChart } from "@/components/freight/ForecastChart";
import { TrendingUp, RefreshCw, BarChart3, Clock } from "lucide-react";

interface BalticMetric {
  current: number;
  change_7d: number;
  change_7d_pct: number;
  change_30d: number;
  change_30d_pct: number;
  sparkline: number[];
}

interface FreightLatestResponse {
  date: string;
  BDI: number;
  BCI: number;
  BPI: number;
  BSI: number;
  BHSI: number;
  metrics?: {
    BDI?: BalticMetric;
    BCI?: BalticMetric;
    BPI?: BalticMetric;
    BSI?: BalticMetric;
    BHSI?: BalticMetric;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export default function FreightPage() {
  const [freightData, setFreightData] = useState<FreightLatestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  async function fetchFreight() {
    try {
      const res = await fetch(`${API_BASE}/freight/latest`);
      if (res.ok) {
        const json = await res.json();
        setFreightData(json);
        setLastRefreshed(new Date());
      }
    } catch (err) {
      console.error("Failed to load /freight/latest", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchFreight();
    const interval = setInterval(fetchFreight, 15000);
    return () => clearInterval(interval);
  }, []);

  const metrics = freightData?.metrics;

  const statCards = [
    {
      id: "BDI",
      title: "BALTIC DRY (BDI)",
      badge: (
        <span className="rounded bg-blue-950/50 border border-blue-800/50 px-1.5 py-0.2 font-mono text-[9px] text-blue-400 font-semibold">
          COMPOSITE
        </span>
      ),
      value: freightData?.BDI ? freightData.BDI.toLocaleString() : "--",
      unit: "pts",
      metric: metrics?.BDI,
      sparklineColor: "#3b82f6",
    },
    {
      id: "BCI",
      title: "CAPESIZE (BCI)",
      badge: (
        <span className="rounded bg-purple-950/50 border border-purple-800/50 px-1.5 py-0.2 font-mono text-[9px] text-purple-400 font-semibold">
          &ge;260M
        </span>
      ),
      value: freightData?.BCI ? freightData.BCI.toLocaleString() : "--",
      unit: "pts",
      metric: metrics?.BCI,
      sparklineColor: "#c084fc",
    },
    {
      id: "BPI",
      title: "PANAMAX (BPI)",
      badge: (
        <span className="rounded bg-sky-950/50 border border-sky-800/50 px-1.5 py-0.2 font-mono text-[9px] text-sky-400 font-semibold">
          215-260M
        </span>
      ),
      value: freightData?.BPI ? freightData.BPI.toLocaleString() : "--",
      unit: "pts",
      metric: metrics?.BPI,
      sparklineColor: "#38bdf8",
    },
    {
      id: "BSI",
      title: "SUPRAMAX (BSI)",
      badge: (
        <span className="rounded bg-cyan-950/50 border border-cyan-800/50 px-1.5 py-0.2 font-mono text-[9px] text-cyan-400 font-semibold">
          170-215M
        </span>
      ),
      value: freightData?.BSI ? freightData.BSI.toLocaleString() : "--",
      unit: "pts",
      metric: metrics?.BSI,
      sparklineColor: "#06b6d4",
    },
  ];

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col p-4 md:p-6 overflow-y-auto space-y-5">
        <div className="mx-auto max-w-6xl w-full space-y-5">
          {/* ── Page Header ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#1f1f23] pb-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-950/50 border border-blue-800/50 text-blue-400">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-[#ededed]">
                  Freight Rate Intelligence
                </h1>
                <span className="rounded bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 font-mono text-[10px] text-blue-400">
                  BALTIC EXCHANGE &middot; DAILY
                </span>
              </div>
              <p className="mt-1 text-xs md:text-sm text-zinc-400">
                Official dry bulk spot indices, multi-horizon quantile forecasting, and input commodity cost feeds.
              </p>
            </div>

            <div className="flex items-center gap-3 font-mono text-xs text-zinc-500">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-zinc-400" />
                <span>As of {freightData?.date ? freightData.date.split("T")[0] : "Today"}</span>
              </div>
              <button
                onClick={() => fetchFreight()}
                title="Refresh latest rates"
                className="rounded p-1 text-zinc-400 hover:bg-[#18181c] hover:text-[#ededed] transition"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* ── Section 1: Header Stat Row (BDI, BCI, BPI, BSI) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {statCards.map((card) => {
              const m = card.metric;
              const hasChange7d = m?.change_7d !== undefined;
              const hasChange30d = m?.change_30d_pct !== undefined;

              const delta7d = hasChange7d
                ? {
                    value: `${m.change_7d_pct >= 0 ? "+" : ""}${m.change_7d_pct.toFixed(1)}%`,
                    isPositive: m.change_7d >= 0,
                    label: "(7d)",
                  }
                : undefined;

              const subValue = hasChange30d
                ? `30d: ${m.change_30d_pct >= 0 ? "+" : ""}${m.change_30d_pct.toFixed(1)}%`
                : undefined;

              return (
                <StatCard
                  key={card.id}
                  title={card.title}
                  badge={card.badge}
                  value={card.value}
                  unit={card.unit}
                  delta={delta7d}
                  subValue={subValue}
                  sparklineData={m?.sparkline}
                  sparklineColor={card.sparklineColor}
                />
              );
            })}
          </div>

          {/* ── Section 3: Global Commodities & FX Strip ── */}
          <CommoditiesStrip />

          {/* ── Section 2 & 4: Forecast Chart & Deliberate Honesty Caption ── */}
          <ForecastChart />
        </div>
      </div>
    </AppShell>
  );
}
