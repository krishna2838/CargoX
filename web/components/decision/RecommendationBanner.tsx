"use client";

import React from "react";
import {
  Award,
  Ship,
  CalendarCheck,
  CalendarX,
  TrendingUp,
  TrendingDown,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { RiskBadge } from "../ui/RiskBadge";
import { Sparkline } from "../ui/Sparkline";

export interface RecommendationData {
  vessel_class: string;
  sub_index?: string;
  feasible?: boolean;
  landed_cost_p50_inr: number;
  freight_cost_p50_inr: number;
  commodity_cost_inr?: number;
  eta: string;
  laycan_status?: string;
  laycan_compatible?: boolean;
  days_offset_laycan?: number;
  timing?: string;
  timing_signal?: string;
  timing_confidence?: string;
  timing_headline?: string;
  timing_reason?: string;
  timing_pct_change?: number;
  risk_score: number;
  risk_band: string;
  example_vessel?: {
    name?: string;
    mmsi?: number;
    loa?: number | null;
    beam?: number | null;
    draft?: number | null;
    speed?: number | null;
  } | null;
}

interface RecommendationBannerProps {
  rec: RecommendationData;
  sparklineData?: number[];
}

export function RecommendationBanner({
  rec,
  sparklineData,
}: RecommendationBannerProps) {
  const timing = (rec.timing || rec.timing_signal || "charter_now").toLowerCase();
  const isWithinLaycan = rec.laycan_compatible ?? (rec.laycan_status === "within_window");

  const timingColor =
    timing === "charter_now"
      ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-400"
      : timing === "wait_spot"
        ? "bg-amber-950/60 border-amber-500/50 text-amber-400"
        : "bg-blue-950/60 border-blue-500/50 text-blue-400";

  const timingHeadline =
    rec.timing_headline ||
    (timing === "charter_now"
      ? "Charter now — freight upward trajectory"
      : timing === "wait_spot"
        ? "Wait for spot market — freight softening"
        : "Split procurement: hedge volatility between spot & contract");

  const firstLanded = sparklineData && sparklineData.length > 0 ? sparklineData[0] : null;
  const lastLanded =
    sparklineData && sparklineData.length > 0 ? sparklineData[sparklineData.length - 1] : null;
  const horizonChange =
    firstLanded && lastLanded ? ((lastLanded - firstLanded) / firstLanded) * 100 : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-blue-900/40 bg-gradient-to-br from-[#121217] via-[#0f1015] to-[#0a0a0f] p-5 sm:p-6 shadow-2xl">
      {/* Background glowing ambient light */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-600/10 blur-3xl" />

      <div className="relative z-10 flex flex-col gap-5">
        {/* ── Top Bar: Winner Tag + Risk Badge ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f1f26] pb-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Award className="h-3.5 w-3.5" />
            </span>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-blue-400">
              OPTIMAL CHARTER RECOMMENDATION
            </span>
            <span className="rounded bg-blue-950/60 border border-blue-800/60 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
              {rec.vessel_class} Class
            </span>
          </div>

          <div className="flex items-center gap-2">
            <RiskBadge band={rec.risk_band} score={rec.risk_score} size="md" />
          </div>
        </div>

        {/* ── Main Metrics Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Big Monospace Landed Cost (Left, 5 cols) */}
          <div className="lg:col-span-5 space-y-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Estimated Landed Cost (P50)
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl sm:text-4xl font-bold tracking-tight text-white">
                ₹{Math.round(rec.landed_cost_p50_inr).toLocaleString("en-IN")}
              </span>
              <span className="font-mono text-sm text-zinc-400">/ MT</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-400 pt-1">
              <span>Freight: ₹{rec.freight_cost_p50_inr.toFixed(0)}/t</span>
              <span className="text-zinc-600">&bull;</span>
              <span>Sub-index: {rec.sub_index}</span>
            </div>
          </div>

          {/* Timing Call & Driving Number (Center, 4 cols) */}
          <div className="lg:col-span-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Clock className="h-3.5 w-3.5 text-blue-400" />
              <span>TIMING SIGNAL</span>
            </div>

            <div
              className={`rounded-lg border px-3 py-2 font-mono text-xs space-y-1 ${timingColor}`}
            >
              <div className="flex items-center justify-between font-bold uppercase tracking-wider text-xs">
                <span>{timing.replace("_", " ")}</span>
                {rec.timing_pct_change !== undefined && (
                  <span>
                    {rec.timing_pct_change >= 0 ? "+" : ""}
                    {rec.timing_pct_change.toFixed(1)}% (4w)
                  </span>
                )}
              </div>
              <p className="text-[11px] font-sans opacity-90 leading-tight">
                {timingHeadline}
              </p>
            </div>
          </div>

          {/* Mini Landed Cost Sparkline (Right, 3 cols) */}
          <div className="lg:col-span-3 flex flex-col justify-between rounded-lg border border-[#1f1f23] bg-[#141418] p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
              <span>28-DAY TRAJECTORY</span>
              {horizonChange !== null && (
                <span
                  className={`font-semibold ${
                    horizonChange >= 0 ? "text-rose-400" : "text-emerald-400"
                  }`}
                >
                  {horizonChange >= 0 ? "+" : ""}
                  {horizonChange.toFixed(1)}%
                </span>
              )}
            </div>

            {sparklineData && sparklineData.length > 1 ? (
              <div className="py-1">
                <Sparkline
                  data={sparklineData}
                  width={160}
                  height={28}
                  color={(rec.timing_pct_change ?? 0) >= 0 ? "#f43f5e" : "#10b981"}
                />
              </div>
            ) : (
              <div className="font-mono text-[10px] text-zinc-600">Trajectory static</div>
            )}

            <div className="flex justify-between text-[9px] font-mono text-zinc-500 border-t border-[#1f1f23] pt-1">
              <span>Day 1: ₹{Math.round(firstLanded || rec.landed_cost_p50_inr)}</span>
              <span>Day 28: ₹{Math.round(lastLanded || rec.landed_cost_p50_inr)}</span>
            </div>
          </div>
        </div>

        {/* ── Operational Footnote: Example Vessel & Laycan Status ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1f1f23] pt-3 text-xs font-mono">
          {/* Example live vessel */}
          {rec.example_vessel ? (
            <div className="flex items-center gap-2 text-zinc-300">
              <Ship className="h-3.5 w-3.5 text-blue-400" />
              <span>Example Candidate:</span>
              <span className="font-semibold text-white">
                {rec.example_vessel.name || `MMSI ${rec.example_vessel.mmsi}`}
              </span>
              <span className="text-zinc-500">
                ({rec.example_vessel.loa ? `${Math.round(rec.example_vessel.loa)}m LOA` : ""}
                {rec.example_vessel.draft ? `, ${rec.example_vessel.draft}m draft` : ""})
              </span>
            </div>
          ) : (
            <div className="text-zinc-500">No active AIS ship matched class specs</div>
          )}

          {/* ETA vs Laycan badge */}
          <div className="flex items-center gap-1.5">
            {isWithinLaycan ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 text-[11px] text-emerald-400">
                <CalendarCheck className="h-3.5 w-3.5" />
                <span>Within Laycan &bull; ETA {rec.eta}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-amber-950/40 border border-amber-800/50 px-2 py-0.5 text-[11px] text-amber-400">
                <CalendarX className="h-3.5 w-3.5" />
                <span>
                  Arrives {rec.days_offset_laycan || "after"} days late &bull; ETA {rec.eta}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
