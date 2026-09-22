"use client";

import React from "react";
import { HelpCircle, ShieldAlert, BarChart2, CheckCircle } from "lucide-react";

export interface RiskDriver {
  name: string;
  score: number;
  weight: number;
  contribution: number;
  description: string;
}

interface RiskExplanationCardProps {
  explanation: string;
  drivers?: RiskDriver[];
  totalRiskScore?: number;
  riskBand?: string;
}

export function RiskExplanationCard({
  explanation,
  drivers = [],
  totalRiskScore,
  riskBand,
}: RiskExplanationCardProps) {
  return (
    <div className="w-full rounded-xl border border-[#1f1f23] bg-[#121214] p-5 shadow-lg space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1f1f23] pb-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-950/60 border border-blue-800/60 text-blue-400">
            <HelpCircle className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-[#ededed]">
              Why this Recommendation?
            </h3>
            <p className="text-[11px] text-zinc-400">
              Deterministic evaluation of draft clearance, landed economics, and risk factors
            </p>
          </div>
        </div>

        {totalRiskScore !== undefined && (
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-zinc-500">COMPOSITE RISK:</span>
            <span className="font-bold text-[#ededed]">{totalRiskScore} / 100</span>
          </div>
        )}
      </div>

      {/* ── Executive Narrative Text ── */}
      <div className="rounded-lg border border-[#1f1f23] bg-[#161619] p-4 text-xs sm:text-sm text-zinc-200 leading-relaxed space-y-2">
        <p className="font-sans">{explanation}</p>
      </div>

      {/* ── 4-Driver Risk Contribution Bars ── */}
      {drivers.length > 0 && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between font-mono text-xs text-zinc-400">
            <div className="flex items-center gap-1.5 uppercase font-semibold text-[11px] tracking-wider text-zinc-300">
              <BarChart2 className="h-3.5 w-3.5 text-blue-400" />
              <span>Multi-Factor Risk Decomposition</span>
            </div>
            <span className="text-[10px] text-zinc-500">Contribution to composite score</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {drivers.map((driver) => {
              const pct = Math.min(100, Math.max(0, driver.score));
              const barColor =
                driver.score >= 80
                  ? "bg-rose-500"
                  : driver.score >= 50
                    ? "bg-amber-500"
                    : "bg-emerald-500";

              return (
                <div
                  key={driver.name}
                  className="rounded-lg border border-[#1f1f23] bg-[#151518] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="font-semibold text-[#ededed]">{driver.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500 text-[10px]">
                        Weight: {(driver.weight * 100).toFixed(0)}%
                      </span>
                      <span className="font-bold text-[#ededed]">{driver.score}/100</span>
                    </div>
                  </div>

                  {/* Horizontal Bar */}
                  <div className="h-2 w-full rounded-full bg-[#202026] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="flex items-baseline justify-between text-[11px] text-zinc-400">
                    <span className="truncate pr-2">{driver.description}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                      +{driver.contribution.toFixed(1)} pts
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
