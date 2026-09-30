"use client";

import React from "react";
import { Ship, ArrowRight } from "lucide-react";
import { DataTable, Column } from "../ui/DataTable";
import { RiskBadge } from "../ui/RiskBadge";
import { Sparkline } from "../ui/Sparkline";

export interface Voyage {
  voyage_num: number;
  eta_load: string;
  eta_discharge: string;
  vessel_class: string;
  parcel_tonnes: number;
  index: string;
  index_p50: number;
  freight_inr_per_t: number;
  landed_cost_inr_per_t: number;
  landed_cost_inr: number;
  risk_score: number;
  risk_band: string;
}

interface VoyageScheduleProps {
  schedule: Voyage[];
  className?: string;
}

const fmtDate = (iso: string): string => {
  // Render as e.g. "01 Nov" — keeps rows compact.
  try {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  } catch {
    return iso;
  }
};

const fmtINR = (n: number): string =>
  "₹" + Math.round(n).toLocaleString("en-IN");

export function VoyageSchedule({ schedule, className = "" }: VoyageScheduleProps) {
  const costTrend = schedule.map((v) => v.landed_cost_inr_per_t);
  const trendColor =
    schedule.length >= 2 && costTrend[costTrend.length - 1] <= costTrend[0]
      ? "#10b981" // green — cost dropping over the contract
      : "#f43f5e"; // rose — cost climbing

  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  const columns: Column<Voyage>[] = [
    {
      key: "voyage_num",
      header: "#",
      width: "44px",
      accessor: (v) => (
        <span className="font-mono text-[11px] font-semibold text-blue-500">
          V{v.voyage_num}
        </span>
      ),
    },
    {
      key: "window",
      header: "Window",
      accessor: (v) => (
        <span className="font-mono text-[11px] text-cx-text">
          {fmtDate(v.eta_load)}{" "}
          <ArrowRight className="inline h-3 w-3 text-cx-text-muted mx-0.5" />{" "}
          {fmtDate(v.eta_discharge)}
        </span>
      ),
    },
    {
      key: "vessel",
      header: "Vessel",
      accessor: (v) => (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-blue-500">
          <Ship className="h-3 w-3" />
          {v.vessel_class}
        </span>
      ),
    },
    {
      key: "index",
      header: "Index",
      align: "right",
      accessor: (v) => (
        <span className="font-mono text-[11px] text-cx-text-secondary">
          {v.index} <span className="text-cx-text">{v.index_p50.toFixed(0)}</span>
        </span>
      ),
    },
    {
      key: "freight",
      header: "Freight ₹/t",
      align: "right",
      accessor: (v) => (
        <span className="font-mono text-[11px] text-cx-text">
          {fmtINR(v.freight_inr_per_t)}
        </span>
      ),
    },
    {
      key: "landed",
      header: "Landed ₹/t",
      align: "right",
      accessor: (v) => (
        <span className="font-mono text-[11px] font-semibold text-cx-text">
          {fmtINR(v.landed_cost_inr_per_t)}
        </span>
      ),
    },
    {
      key: "risk",
      header: "Risk",
      align: "right",
      accessor: (v) => <RiskBadge band={v.risk_band} score={v.risk_score} size="sm" />,
    },
  ];

  return (
    <div className={`rounded-xl border border-cx-border bg-cx-card ${className}`}>
      {/* Header w/ trend sparkline */}
      <div className="flex items-center justify-between border-b border-cx-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-cx-text">Voyage Schedule</h2>
          <p className="text-[11px] text-cx-text-muted mt-0.5">
            {schedule.length} voyages · {first && last
              ? `${fmtDate(first.eta_load)} → ${fmtDate(last.eta_discharge)}`
              : "—"}
          </p>
        </div>
        {schedule.length >= 2 && (
          <div className="flex items-center gap-2 rounded border border-cx-border-subtle bg-cx-bg px-2.5 py-1.5">
            <span className="text-[10px] text-cx-text-muted uppercase font-semibold tracking-wider">
              Cost trend
            </span>
            <Sparkline data={costTrend} width={110} height={26} color={trendColor} />
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        data={schedule}
        keyExtractor={(v) => v.voyage_num}
        emptyMessage="No voyages scheduled."
        className="rounded-none border-0"
      />
    </div>
  );
}
