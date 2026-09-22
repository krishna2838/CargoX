"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import {
  DecisionForm,
  DecisionFormValues,
  PortOption,
} from "@/components/decision/DecisionForm";
import {
  RecommendationBanner,
  RecommendationData,
} from "@/components/decision/RecommendationBanner";
import {
  ScenarioTable,
  ScenarioItem,
} from "@/components/decision/ScenarioTable";
import {
  RiskExplanationCard,
} from "@/components/decision/RiskExplanationCard";
import { RouteRiskStrip } from "@/components/decision/RouteRiskStrip";
import {
  ArrowLeft,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

interface DecisionResponse {
  recommendation: RecommendationData;
  scenarios: ScenarioItem[];
  forecast_summary?: any;
  explanation: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

function DecisionContent() {
  const searchParams = useSearchParams();
  const destParam = searchParams.get("dest") || "paradip";
  const mmsiParam = searchParams.get("mmsi") || null;

  // Reference ports
  const [loadPorts, setLoadPorts] = useState<PortOption[]>([]);
  const [destPorts, setDestPorts] = useState<PortOption[]>([]);

  // Form parameters
  const [formValues, setFormValues] = useState<DecisionFormValues>({
    cargo_tonnes: 50000,
    commodity: "coking_coal",
    load_port_id: "hay_point",
    dest_port_id: destParam,
    laycan_start: "2026-10-05",
    laycan_end: "2026-10-25",
  });

  // API State
  const [decisionData, setDecisionData] = useState<DecisionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load reference ports
  useEffect(() => {
    let cancelled = false;

    async function fetchPorts() {
      try {
        const [lRes, dRes] = await Promise.all([
          fetch(`${API_BASE}/load_ports`),
          fetch(`${API_BASE}/ports`),
        ]);

        if (lRes.ok && !cancelled) {
          const lData = await lRes.json();
          setLoadPorts(lData);
        }
        if (dRes.ok && !cancelled) {
          const dData = await dRes.json();
          setDestPorts(dData);
          // If destParam matches one of the ports, ensure it is set
          if (destParam && dData.some((p: any) => p.id === destParam)) {
            setFormValues((v) => ({ ...v, dest_port_id: destParam }));
          }
        }
      } catch (err) {
        console.error("Failed to load reference ports", err);
      }
    }

    fetchPorts();
    return () => {
      cancelled = true;
    };
  }, [destParam]);

  // Run decision simulation
  async function runDecision(valuesToRun = formValues) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cargo_tonnes: valuesToRun.cargo_tonnes,
          commodity: valuesToRun.commodity,
          load_port_id: valuesToRun.load_port_id,
          dest_port_id: valuesToRun.dest_port_id,
          laycan_start: valuesToRun.laycan_start,
          laycan_end: valuesToRun.laycan_end,
          horizon_days: 28,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Simulation failed with status ${res.status}`);
      }

      const data: DecisionResponse = await res.json();
      setDecisionData(data);
    } catch (err: any) {
      console.error("Decision engine API error:", err);
      setError(err.message || "Unable to compute procurement decision.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-run once on initial mount
  useEffect(() => {
    runDecision();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rec = decisionData?.recommendation;
  const scenarios = decisionData?.scenarios || [];
  const feasibleScenarios = scenarios.filter((s) => s.feasible);
  const isAllInfeasible = !loading && decisionData && feasibleScenarios.length === 0;

  // Extract sparkline from winning scenario or fallback
  const winningScenario = scenarios.find(
    (s) => s.vessel_class === rec?.vessel_class
  );
  const sparklineData = (winningScenario as any)?.forecast_trajectory?.landed_inr_p50;
  const riskDrivers = winningScenario?.risk?.drivers || [];

  return (
    <div className="flex h-full w-full flex-col p-4 md:p-6 overflow-y-auto space-y-6 bg-cx-bg">
      <div className="mx-auto max-w-6xl w-full space-y-6">
        {/* ── Breadcrumb & Top Bar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-cx-border pb-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs font-mono text-cx-text-secondary hover:text-blue-500 transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>LIVE MAP</span>
            </Link>
            <span className="text-cx-border-subtle">/</span>
            <span className="text-xs font-mono text-cx-text font-semibold uppercase">
              PROCUREMENT DECISION ENGINE
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded bg-blue-500/10 border border-blue-500/30 px-2.5 py-0.5 font-mono text-[10px] text-blue-500 font-semibold">
              MULTI-CRITERIA CHARTER MATRIX
            </span>
          </div>
        </div>

        {/* ── Page Intro ── */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-cx-text">
            Chartering &amp; Procurement Decision
          </h1>
          <p className="mt-1 text-xs md:text-sm text-cx-text-secondary">
            Synthesizes draft limits, 28-day Baltic freight forecasting, deterministic voyage physics, and multi-factor risk into a ranked procurement recommendation.
          </p>
        </div>

        {/* ── Section 1: Interactive Parameter Form ── */}
        <DecisionForm
          values={formValues}
          onChange={setFormValues}
          onSubmit={() => runDecision(formValues)}
          loading={loading}
          loadPorts={loadPorts}
          destPorts={destPorts}
          selectedMmsi={mmsiParam}
        />

        {/* ── ERROR STATE: Backend down or call failure with Retry ── */}
        {error && !loading && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 space-y-3 font-mono text-xs">
            <div className="flex items-center gap-2 text-rose-500 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              <span>DECISION ENGINE SERVICE UNAVAILABLE</span>
            </div>
            <p className="text-cx-text font-sans">{error}</p>
            <div className="pt-2">
              <button
                onClick={() => runDecision(formValues)}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 font-mono text-xs font-semibold text-white hover:bg-rose-500 transition cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Retry Simulation</span>
              </button>
            </div>
          </div>
        )}

        {/* ── ZERO FEASIBLE SCENARIOS STATE ── */}
        {isAllInfeasible && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-4 font-mono text-xs">
            <div className="flex items-center gap-2 text-amber-500 font-semibold text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span>NO VESSEL CLASS FITS THIS COMBINATION</span>
            </div>
            <p className="text-cx-text font-sans">
              Every dry bulk vessel class encountered physical or operational constraints for this trade lane. Consider widening the laycan delivery window or selecting a deeper-draft discharge port.
            </p>

            <div className="rounded-lg border border-amber-500/20 bg-cx-surface p-3 space-y-2">
              <div className="text-cx-text-secondary text-[11px] font-semibold uppercase">
                Observed Class Bottlenecks:
              </div>
              <ul className="space-y-1 text-cx-text">
                {scenarios.map((s) => (
                  <li key={s.vessel_class} className="flex items-start gap-2">
                    <span className="font-semibold text-amber-500 min-w-[90px]">
                      {s.vessel_class}:
                    </span>
                    <span className="text-cx-text-secondary">{s.feasibility_detail.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ── LOADING SKELETON ── */}
        {loading && (
          <div className="rounded-xl border border-cx-border bg-cx-card p-10 flex flex-col items-center justify-center space-y-3 font-mono text-xs text-cx-text-secondary">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <div className="font-semibold text-blue-500">
              SOLVING MULTI-CRITERIA CHARTER MATRIX
            </div>
            <p className="text-cx-text-muted text-[11px] text-center max-w-md">
              Evaluating port drafts, running LightGBM 28-day quantile forecasts, computing VLSFO bunker burn, and calculating composite risk scores…
            </p>
          </div>
        )}

        {/* ── SUCCESSFUL RESULTS ── */}
        {!loading && decisionData && !error && (
          <div className="space-y-6">
            {/* Section 2: Recommendation Banner */}
            {rec && (
              <RecommendationBanner
                rec={{
                  ...rec,
                  sub_index: decisionData.forecast_summary?.sub_index || winningScenario?.sub_index,
                  timing_pct_change: decisionData.forecast_summary?.pct_change_horizon,
                }}
                sparklineData={sparklineData}
              />
            )}

            {/* Section 2.5: Sea Lane Route Weather & Cyclone Risk Strip */}
            <RouteRiskStrip
              loadPortId={formValues.load_port_id}
              destPortId={formValues.dest_port_id}
            />

            {/* Section 3 & 4: Ranked Scenario Table with expandable rows */}
            {scenarios.length > 0 && <ScenarioTable scenarios={scenarios} />}

            {/* Section 5: Why this recommendation card & Risk decomposition */}
            {decisionData.explanation && (
              <RiskExplanationCard
                explanation={decisionData.explanation}
                drivers={riskDrivers}
                totalRiskScore={rec?.risk_score}
                riskBand={rec?.risk_band}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DecisionPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center font-mono text-xs text-cx-text-muted">
            Initializing Decision Engine…
          </div>
        }
      >
        <DecisionContent />
      </Suspense>
    </AppShell>
  );
}
