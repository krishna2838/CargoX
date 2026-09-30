"use client";

import React from "react";
import { Wallet, TrendingDown, TrendingUp, PiggyBank, CalendarClock } from "lucide-react";
import { StatCard } from "../ui/StatCard";

export interface ContractSummaryData {
  contract: {
    type: string;
    start: string;
    end: string;
    total_tonnes: number;
    parcel_size: number;
    voyage_count: number;
    spacing_days: number;
    vessel_class: string;
    commodity: string;
    load_port: { id: string; name: string };
    dest_port: { id: string; name: string };
  };
  aggregate: {
    total_landed_cost_inr: number;
    avg_landed_cost_per_t_inr: number;
    spot_comparison_inr_per_t: number;
    spot_total_cost_inr: number;
    savings_vs_spot_pct: number;
    savings_vs_spot_inr: number;
  };
  recommendation: {
    contract_type: string;
    reason: string;
  };
}

interface ContractSummaryProps {
  data: ContractSummaryData;
  className?: string;
}

const fmtINRCompact = (n: number): string => {
  // Convert to crore / lakh for readability; keeps the raw number on hover.
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

const fmtINRPerT = (n: number): string =>
  "₹" + Math.round(n).toLocaleString("en-IN");

export function ContractSummary({ data, className = "" }: ContractSummaryProps) {
  const { contract, aggregate, recommendation } = data;
  const savingsPositive = aggregate.savings_vs_spot_pct >= 0;
  const isContractRec = recommendation.contract_type !== "spot";

  const badgeClass = isContractRec
    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
    : "bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400";

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Verdict banner — mirrors the visual language of RecommendationBanner
          but is contract-specific (aggregate savings vs spot, not a single
          vessel scoring). The one-line reason from the engine explains why. */}
      <div className="rounded-xl border border-cx-border bg-cx-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-cx-text-muted">
                Contract Verdict
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${badgeClass}`}
              >
                {isContractRec
                  ? <><PiggyBank className="h-3 w-3" /> Lock {recommendation.contract_type} Contract</>
                  : <><CalendarClock className="h-3 w-3" /> Prefer Spot</>
                }
              </span>
            </div>
            <p className="text-sm text-cx-text leading-relaxed">
              {recommendation.reason}
            </p>
            <p className="mt-2 text-[11px] text-cx-text-muted">
              {contract.commodity} · {contract.load_port.name} → {contract.dest_port.name}
              · {contract.vessel_class} · {contract.voyage_count} voyages every {contract.spacing_days} days
              · {contract.start} → {contract.end}
            </p>
          </div>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard
          title="Total Contract Value"
          value={fmtINRCompact(aggregate.total_landed_cost_inr)}
          subValue={`${contract.total_tonnes.toLocaleString()} t landed`}
          icon={<Wallet className="h-4 w-4" />}
        />
        <StatCard
          title="Avg Landed / Tonne"
          value={fmtINRPerT(aggregate.avg_landed_cost_per_t_inr)}
          unit="/t"
          subValue={`vs spot ${fmtINRPerT(aggregate.spot_comparison_inr_per_t)}/t`}
          delta={{
            value: `${savingsPositive ? "−" : "+"}${Math.abs(aggregate.savings_vs_spot_pct).toFixed(2)}%`,
            isPositive: savingsPositive,
            label: "vs spot",
          }}
          icon={savingsPositive
            ? <TrendingDown className="h-4 w-4 text-emerald-500" />
            : <TrendingUp className="h-4 w-4 text-rose-500" />
          }
        />
        <StatCard
          title="Spot Benchmark (same voyages)"
          value={fmtINRCompact(aggregate.spot_total_cost_inr)}
          subValue={`priced at today's ${fmtINRPerT(aggregate.spot_comparison_inr_per_t)}/t`}
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <StatCard
          title={savingsPositive ? "Savings vs Spot" : "Premium vs Spot"}
          value={fmtINRCompact(Math.abs(aggregate.savings_vs_spot_inr))}
          subValue={`${Math.abs(aggregate.savings_vs_spot_pct).toFixed(2)}% ${savingsPositive ? "saved" : "extra"}`}
          delta={{
            value: `${savingsPositive ? "+" : "−"}${Math.abs(aggregate.savings_vs_spot_pct).toFixed(2)}%`,
            isPositive: savingsPositive,
          }}
          icon={<PiggyBank className="h-4 w-4" />}
          className={savingsPositive
            ? "border-emerald-500/30"
            : "border-amber-500/30"}
        />
      </div>
    </div>
  );
}
