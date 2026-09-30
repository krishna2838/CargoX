"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Ship } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import {
  ContractForm,
  ContractFormValues,
  PortOption,
} from "@/components/contract/ContractForm";
import {
  VoyageSchedule,
  Voyage,
} from "@/components/contract/VoyageSchedule";
import {
  ContractSummary,
  ContractSummaryData,
} from "@/components/contract/ContractSummary";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

interface ContractResponse extends ContractSummaryData {
  schedule: Voyage[];
}

const DEFAULTS: ContractFormValues = {
  annual_tonnes: 600_000,
  parcel_size:    75_000,
  commodity:     "coking_coal",
  load_port_id:  "hay_point",
  dest_port_id:  "paradip",
  contract_months: 6,
  start_date:    "2026-11-01",
};

function ContractPageContent() {
  const [loadPorts, setLoadPorts] = useState<PortOption[]>([]);
  const [destPorts, setDestPorts] = useState<PortOption[]>([]);
  const [formValues, setFormValues] = useState<ContractFormValues>(DEFAULTS);
  const [data, setData]       = useState<ContractResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError]     = useState<string | null>(null);

  // ── Reference ports ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchPorts() {
      try {
        const [lp, dp] = await Promise.all([
          fetch(`${API_BASE}/load-ports`).then((r) => r.json()),
          fetch(`${API_BASE}/ports`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setLoadPorts((lp || []).map((p: any) => ({ id: p.id, name: p.name })));
        setDestPorts((dp || []).map((p: any) => ({ id: p.id, name: p.name })));
      } catch (e) {
        if (!cancelled) setError("Could not load reference ports.");
      }
    }
    fetchPorts();
    return () => { cancelled = true; };
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────
  const runPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Router maps ValueError → 400 with `detail` string.
        setError(typeof body?.detail === "string" ? body.detail : `Request failed (${res.status})`);
        setData(null);
      } else {
        setData(body as ContractResponse);
      }
    } catch (e: any) {
      setError(e?.message || "Network error while contacting /contract");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // Auto-run once ports are loaded so the page isn't blank on arrival.
  useEffect(() => {
    if (loadPorts.length && destPorts.length && !data && !loading && !error) {
      runPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPorts.length, destPorts.length]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Page header strip */}
      <div className="flex items-center justify-between border-b border-cx-border bg-cx-surface px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-2.5">
          <Ship className="h-4 w-4 text-blue-500" />
          <div>
            <h1 className="text-sm font-semibold text-cx-text">Multi-Voyage Contract Planner</h1>
            <p className="hidden sm:block text-[11px] text-cx-text-muted mt-0.5">
              Fan out the forecast across a schedule and compare a locked contract to today's spot rate.
            </p>
          </div>
        </div>
      </div>

      {/* Body: 35% form / 65% results (stacks below md) */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,35%)_minmax(0,65%)] gap-4 md:gap-6">
          <ContractForm
            values={formValues}
            onChange={setFormValues}
            onSubmit={runPlan}
            onReset={() => { setFormValues(DEFAULTS); setError(null); }}
            loadPorts={loadPorts}
            destPorts={destPorts}
            loading={loading}
          />

          <div className="flex flex-col gap-4 min-w-0">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Contract planner error</p>
                  <p className="text-[11px] mt-0.5 opacity-90">{error}</p>
                </div>
              </div>
            )}

            {loading && !data && (
              <div className="animate-pulse rounded-xl border border-cx-border bg-cx-card p-6 text-center text-xs text-cx-text-muted font-mono">
                Fanning forecast across voyages…
              </div>
            )}

            {data && (
              <>
                <ContractSummary data={data} />
                <VoyageSchedule schedule={data.schedule} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ContractPage() {
  return (
    <AppShell>
      <ContractPageContent />
    </AppShell>
  );
}
