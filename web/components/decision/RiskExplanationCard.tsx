"use client";

import React from "react";
import { HelpCircle, BarChart2 } from "lucide-react";

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
}: RiskExplanationCardProps) {
  return (
    <div className="w-full rounded-xl border border-cx-border bg-cx-card p-5 shadow-lg space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cx-border pb-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-500">
            <HelpCircle className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-cx-text">
              Why this Recommendation?
            </h3>
            <p className="text-[11px] text-cx-text-secondary">
              Deterministic evaluation of draft clearance, landed economics, and risk factors
            </p>
          </div>
        </div>

        {totalRiskScore !== undefined && (
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-cx-text-muted">COMPOSITE RISK:</span>
            <span className="font-bold text-cx-text">{totalRiskScore} / 100</span>
          </div>
        )}
      </div>

      {/* ── Executive Narrative Text ── */}
      <div className="rounded-lg border border-cx-border bg-cx-surface p-4 text-xs sm:text-sm text-cx-text leading-relaxed space-y-2">
        <p className="font-sans">{explanation}</p>
      </div>

      {/* ── 4-Driver Risk Contribution Bars ── */}
      {drivers.length > 0 && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between font-mono text-xs text-cx-text-secondary">
            <div className="flex items-center gap-1.5 uppercase font-semibold text-[11px] tracking-wider text-cx-text">
              <BarChart2 className="h-3.5 w-3.5 text-blue-500" />
              <span>Multi-Factor Risk Decomposition</span>
            </div>
            <span className="text-[10px] text-cx-text-muted">Contribution to composite score</span>
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
                  className="rounded-lg border border-cx-border bg-cx-surface p-3 space-y-2"
                >
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="font-semibold text-cx-text">{driver.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-cx-text-muted text-[10px]">
                        Weight: {(driver.weight * 100).toFixed(0)}%
                      </span>
                      <span className="font-bold text-cx-text">{driver.score}/100</span>
                    </div>
                  </div>

                  {/* Horizontal Bar */}
                  <div className="h-2 w-full rounded-full bg-cx-border overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="flex items-baseline justify-between text-[11px] text-cx-text-secondary">
                    <span className="truncate pr-2">{driver.description}</span>
                    <span className="shrink-0 font-mono text-[10px] text-cx-text-muted">
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
