"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  DollarSign,
  Ship,
} from "lucide-react";
import { RiskBadge } from "../ui/RiskBadge";

export interface ScenarioItem {
  vessel_class: string;
  sub_index: string;
  rank_score: number;
  feasible: boolean;
  feasibility_detail: {
    feasible: boolean;
    primary_bottleneck: string;
    summary: string;
    reasons?: string[];
  };
  costs: {
    commodity_cost_per_tonne_inr: number;
    commodity_cost_per_tonne_usd: number;
    freight_cost_per_tonne_inr: { p10: number; p50: number; p90: number };
    freight_cost_per_tonne_usd: { p10: number; p50: number; p90: number };
    landed_cost_per_tonne_inr: { p10: number; p50: number; p90: number };
    landed_cost_per_tonne_usd: { p10: number; p50: number; p90: number };
    daily_hire_usd_p50: number;
    bunker_cost_usd_p50: number;
    port_charges_usd: number;
  };
  voyage: {
    distance_nm: number;
    service_speed_kn: number;
    sea_days: number;
    port_days: number;
    total_voyage_days: number;
    eta: string;
    laycan_compatible: boolean;
    laycan_status: string;
    days_offset_laycan?: number;
  };
  risk: {
    score: number;
    band: string;
    drivers?: Array<{
      name: string;
      score: number;
      weight: number;
      contribution: number;
      description: string;
    }>;
  };
  example_vessel?: {
    name?: string;
    mmsi?: number;
    loa?: number | null;
    beam?: number | null;
    draft?: number | null;
    speed?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    inferred_class?: string;
    eta?: string;
  } | null;
  rank?: number;
}

interface ScenarioTableProps {
  scenarios: ScenarioItem[];
}

export function ScenarioTable({ scenarios }: ScenarioTableProps) {
  const [expandedClass, setExpandedClass] = useState<string | null>(
    scenarios.length > 0 ? scenarios[0].vessel_class : null
  );

  const toggleExpand = (vesselClass: string) => {
    setExpandedClass((curr) => (curr === vesselClass ? null : vesselClass));
  };

  // Sort: Feasible first sorted by Landed Cost P50 ascending, then Infeasible
  const sortedScenarios = [...scenarios].sort((a, b) => {
    if (a.feasible && !b.feasible) return -1;
    if (!a.feasible && b.feasible) return 1;
    return (
      a.costs.landed_cost_per_tonne_inr.p50 -
      b.costs.landed_cost_per_tonne_inr.p50
    );
  });

  return (
    <div className="w-full rounded-xl border border-cx-border bg-cx-card shadow-lg overflow-hidden">
      <div className="flex items-center justify-between border-b border-cx-border px-4 py-3 bg-cx-surface">
        <div>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-cx-text">
            Charter Scenario Comparison Matrix
          </h3>
          <p className="text-[11px] text-cx-text-secondary">
            Ranked by total landed INR cost per MT &bull; Click any row to expand cost breakdown
          </p>
        </div>
        <span className="font-mono text-[10px] text-cx-text-muted">
          {sortedScenarios.filter((s) => s.feasible).length} Feasible / {sortedScenarios.length} Classes
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead className="border-b border-cx-border bg-cx-surface text-[10px] uppercase tracking-wider text-cx-text-muted">
            <tr>
              <th className="px-4 py-2.5">RANK / CLASS</th>
              <th className="px-4 py-2.5 text-right">FREIGHT P50</th>
              <th className="px-4 py-2.5 text-right">LANDED P50</th>
              <th className="px-4 py-2.5">ETA &amp; LAYCAN</th>
              <th className="px-4 py-2.5">DRAFT &amp; FIT</th>
              <th className="px-4 py-2.5">RISK</th>
              <th className="px-3 py-2.5 text-center">AUDIT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cx-border">
            {sortedScenarios.map((item, idx) => {
              const isExpanded = expandedClass === item.vessel_class;
              const isFeasible = item.feasible;

              return (
                <React.Fragment key={item.vessel_class}>
                  <tr
                    onClick={() => toggleExpand(item.vessel_class)}
                    className={`cursor-pointer transition ${
                      !isFeasible
                        ? "opacity-60 bg-cx-surface/60 hover:opacity-90 hover:bg-cx-hover"
                        : isExpanded
                          ? "bg-cx-hover"
                          : "hover:bg-cx-hover"
                    }`}
                  >
                    {/* Rank / Class */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                            isFeasible
                              ? idx === 0
                                ? "bg-blue-600 text-white shadow-xs"
                                : "bg-cx-surface text-cx-text border border-cx-border"
                              : "bg-cx-surface text-cx-text-muted"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-semibold text-cx-text">
                            {item.vessel_class}
                          </div>
                          <div className="text-[10px] text-cx-text-muted">
                            Index: {item.sub_index}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Freight P50 */}
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <div className="text-cx-text font-semibold">
                        ₹{Math.round(item.costs.freight_cost_per_tonne_inr.p50).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-cx-text-muted">
                        ${item.costs.freight_cost_per_tonne_usd.p50.toFixed(2)}/t
                      </div>
                    </td>

                    {/* Landed P50 */}
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <div
                        className={`text-sm font-bold ${
                          idx === 0 && isFeasible ? "text-emerald-500 dark:text-emerald-400" : "text-cx-text"
                        }`}
                      >
                        ₹{Math.round(item.costs.landed_cost_per_tonne_inr.p50).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-cx-text-muted">
                        ${item.costs.landed_cost_per_tonne_usd.p50.toFixed(2)}/t
                      </div>
                    </td>

                    {/* ETA & Laycan */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="text-cx-text">{item.voyage.eta}</div>
                      <div className="text-[10px]">
                        {item.voyage.laycan_compatible ? (
                          <span className="text-emerald-500 dark:text-emerald-400 font-medium">✓ In window</span>
                        ) : (
                          <span className="text-amber-500 dark:text-amber-400 font-medium">
                            ⚠ {item.voyage.days_offset_laycan || "Late"} days late
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Draft & Physical Fit */}
                    <td className="px-4 py-3.5">
                      {isFeasible ? (
                        <div className="flex items-center gap-1.5 text-emerald-500 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          <span className="text-[11px] truncate max-w-[200px]">
                            {item.feasibility_detail.summary || "Feasible"}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-rose-500">
                          <XCircle className="h-4 w-4 shrink-0" />
                          <span className="text-[11px] text-rose-500 truncate max-w-[220px]">
                            {item.feasibility_detail.summary || "Infeasible"}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Risk Badge */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <RiskBadge band={item.risk.band} score={item.risk.score} size="sm" />
                    </td>

                    {/* Audit / Expand trigger */}
                    <td className="px-3 py-3.5 text-center text-cx-text-secondary">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 inline text-blue-500" />
                      ) : (
                        <ChevronDown className="h-4 w-4 inline" />
                      )}
                    </td>
                  </tr>

                  {/* ── EXPANDED "SHOW YOUR WORKING" AUDIT ROW ── */}
                  {isExpanded && (
                    <tr className="bg-cx-surface/40 border-b border-cx-border">
                      <td colSpan={7} className="p-4 sm:p-5">
                        <div className="space-y-4 font-sans text-xs">
                          {/* Infeasible warning banner if applicable */}
                          {!isFeasible && item.feasibility_detail.reasons && (
                            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-600 dark:text-rose-400 flex items-start gap-2 font-mono text-[11px]">
                              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                              <div>
                                <strong className="font-semibold">Feasibility Violations:</strong>
                                <ul className="list-disc list-inside mt-1 space-y-0.5 opacity-90">
                                  {item.feasibility_detail.reasons.map((r, i) => (
                                    <li key={i}>{r}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}

                          {/* 1. Transparent Voyage Cost Decomposition */}
                          <div>
                            <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-blue-500 uppercase tracking-wider mb-2">
                              <DollarSign className="h-3.5 w-3.5" />
                              <span>Voyage Cost Decomposition (Show Your Working)</span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono">
                              <div className="rounded-lg border border-cx-border bg-cx-card p-2.5">
                                <div className="text-[10px] text-cx-text-muted">DAILY HIRE (P50)</div>
                                <div className="mt-1 font-semibold text-cx-text">
                                  ${Math.round(item.costs.daily_hire_usd_p50).toLocaleString()}/d
                                </div>
                                <div className="text-[9px] text-cx-text-muted">
                                  {item.voyage.total_voyage_days.toFixed(1)} voyage days
                                </div>
                              </div>

                              <div className="rounded-lg border border-cx-border bg-cx-card p-2.5">
                                <div className="text-[10px] text-cx-text-muted">BUNKER COST</div>
                                <div className="mt-1 font-semibold text-cx-text">
                                  ${Math.round(item.costs.bunker_cost_usd_p50).toLocaleString()}
                                </div>
                                <div className="text-[9px] text-cx-text-muted">VLSFO sea + port burn</div>
                              </div>

                              <div className="rounded-lg border border-cx-border bg-cx-card p-2.5">
                                <div className="text-[10px] text-cx-text-muted">PORT DUES</div>
                                <div className="mt-1 font-semibold text-cx-text">
                                  ${Math.round(item.costs.port_charges_usd).toLocaleString()}
                                </div>
                                <div className="text-[9px] text-cx-text-muted">Load &amp; discharge tariffs</div>
                              </div>

                              <div className="rounded-lg border border-cx-border bg-cx-card p-2.5">
                                <div className="text-[10px] text-cx-text-muted">FREIGHT / MT</div>
                                <div className="mt-1 font-semibold text-blue-500">
                                  ₹{Math.round(item.costs.freight_cost_per_tonne_inr.p50).toLocaleString()}
                                </div>
                                <div className="text-[9px] text-cx-text-muted">
                                  ${item.costs.freight_cost_per_tonne_usd.p50.toFixed(2)} / MT
                                </div>
                              </div>

                              <div className="rounded-lg border border-cx-border bg-cx-card p-2.5">
                                <div className="text-[10px] text-cx-text-muted">COMMODITY / MT</div>
                                <div className="mt-1 font-semibold text-cx-text">
                                  ₹{Math.round(item.costs.commodity_cost_per_tonne_inr).toLocaleString()}
                                </div>
                                <div className="text-[9px] text-cx-text-muted">
                                  ${item.costs.commodity_cost_per_tonne_usd.toFixed(2)} FOB
                                </div>
                              </div>

                              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2.5">
                                <div className="text-[10px] text-blue-500 font-semibold">TOTAL LANDED / MT</div>
                                <div className="mt-1 font-bold text-emerald-500 dark:text-emerald-400">
                                  ₹{Math.round(item.costs.landed_cost_per_tonne_inr.p50).toLocaleString()}
                                </div>
                                <div className="text-[9px] text-blue-500">
                                  ${item.costs.landed_cost_per_tonne_usd.p50.toFixed(2)} CFR
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* 2. P10 / P50 / P90 Quantile Envelope Table */}
                          <div>
                            <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-cx-text-secondary uppercase tracking-wider mb-1.5">
                              <span>Probabilistic Quantile Uncertainty Band (28-Day Horizon)</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-xs">
                              <div className="rounded-lg border border-cx-border bg-cx-card p-2.5">
                                <div className="text-[10px] text-cx-text-muted">P10 (BEST CASE / SOFT MARKET)</div>
                                <div className="mt-1 flex items-baseline justify-between">
                                  <span className="text-cx-text-secondary">Freight:</span>
                                  <span className="font-semibold text-blue-500">
                                    ₹{Math.round(item.costs.freight_cost_per_tonne_inr.p10).toLocaleString()}/t
                                  </span>
                                </div>
                                <div className="flex items-baseline justify-between text-cx-text">
                                  <span className="text-cx-text-muted text-[10px]">Landed:</span>
                                  <span className="font-semibold">
                                    ₹{Math.round(item.costs.landed_cost_per_tonne_inr.p10).toLocaleString()}/t
                                  </span>
                                </div>
                              </div>

                              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2.5">
                                <div className="text-[10px] text-blue-500 font-semibold">P50 (EXPECTED BASELINE)</div>
                                <div className="mt-1 flex items-baseline justify-between">
                                  <span className="text-cx-text-secondary">Freight:</span>
                                  <span className="font-semibold text-cx-text">
                                    ₹{Math.round(item.costs.freight_cost_per_tonne_inr.p50).toLocaleString()}/t
                                  </span>
                                </div>
                                <div className="flex items-baseline justify-between text-emerald-500 dark:text-emerald-400">
                                  <span className="text-cx-text-muted text-[10px]">Landed:</span>
                                  <span className="font-bold">
                                    ₹{Math.round(item.costs.landed_cost_per_tonne_inr.p50).toLocaleString()}/t
                                  </span>
                                </div>
                              </div>

                              <div className="rounded-lg border border-cx-border bg-cx-card p-2.5">
                                <div className="text-[10px] text-cx-text-muted">P90 (WORST CASE / TIGHT MARKET)</div>
                                <div className="mt-1 flex items-baseline justify-between">
                                  <span className="text-cx-text-secondary">Freight:</span>
                                  <span className="font-semibold text-blue-500">
                                    ₹{Math.round(item.costs.freight_cost_per_tonne_inr.p90).toLocaleString()}/t
                                  </span>
                                </div>
                                <div className="flex items-baseline justify-between text-cx-text">
                                  <span className="text-cx-text-muted text-[10px]">Landed:</span>
                                  <span className="font-semibold">
                                    ₹{Math.round(item.costs.landed_cost_per_tonne_inr.p90).toLocaleString()}/t
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* 3. Attached Example Vessel Telemetry */}
                          {item.example_vessel && (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cx-border pt-2 font-mono text-[11px] text-cx-text-secondary">
                              <div className="flex items-center gap-1.5">
                                <Ship className="h-3.5 w-3.5 text-blue-500" />
                                <span>Attached Live Ship:</span>
                                <strong className="text-cx-text">
                                  {item.example_vessel.name || `MMSI ${item.example_vessel.mmsi}`}
                                </strong>
                              </div>
                              <div className="flex items-center gap-3">
                                {item.example_vessel.loa && <span>LOA: {Math.round(item.example_vessel.loa)}m</span>}
                                {item.example_vessel.beam && <span>Beam: {Math.round(item.example_vessel.beam)}m</span>}
                                {item.example_vessel.draft && <span>Draft: {item.example_vessel.draft}m</span>}
                                {item.example_vessel.speed && <span>Speed: {item.example_vessel.speed.toFixed(1)}kn</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
