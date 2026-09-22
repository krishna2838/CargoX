"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import {
  Layers,
  Sliders,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Info,
  Clock,
  DollarSign,
  Fuel,
  Ship,
  Flame,
} from "lucide-react";

interface EngineConfig {
  VLSFO_FACTOR: number;
  hire_coefficients: Record<string, { slope: number; intercept: number; comment?: string }>;
  default_load_days: number;
  default_disch_days: number;
  port_charges?: Record<string, number>;
  insurance_rate?: number;
  address_commission?: number;
  misc_voyage_usd?: number;
  vessel_classes: Array<{
    class: string;
    baltic_index: string;
    dwt_min: number;
    dwt_max: number;
    service_speed_kn: number;
    consumption_laden_mt_per_day: number;
    consumption_ballast_mt_per_day: number;
    consumption_port_mt_per_day?: number;
    typical_draft_m: number;
  }>;
  baseline_market: {
    crude_usd_bbl: number;
    usd_inr: number;
    indices: Record<string, number>;
    commodities: Record<string, number>;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export default function WhatIfPage() {
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Simulator Slider Controls ──
  const [selectedClass, setSelectedClass] = useState<string>("Supramax");
  const [freightDeltaPct, setFreightDeltaPct] = useState<number>(0);
  const [usdinrDeltaPct, setUsdinrDeltaPct] = useState<number>(0);
  const [congestionHours, setCongestionHours] = useState<number>(0);
  const [commodityDeltaPct, setCommodityDeltaPct] = useState<number>(0);

  // Constant voyage parameters for Hay Point -> Paradip 50k coal case
  const parcelTonnes = 50000;
  const distanceNm = 4899;
  const commodityType = "coking_coal";

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const res = await fetch(`${API_BASE}/engine/config`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setConfig(data);
        }
      } catch (err) {
        console.error("Failed to load /engine/config", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Exact Deterministic Cost Engine mirror ──
  const computeSimulation = useMemo(() => {
    if (!config || !config.vessel_classes?.length) return null;

    const vClass =
      config.vessel_classes.find((c) => c.class === selectedClass) ||
      config.vessel_classes[0];
    const subIndex = vClass.baltic_index || "BSI";

    // 1. BASELINE CALCULATION (All deltas = 0)
    const baseIndex = config.baseline_market.indices[subIndex] || 1000;
    const baseUsdInr = config.baseline_market.usd_inr || 83.21;
    const baseCommodity = config.baseline_market.commodities[commodityType] || 182.54;

    const speed = vClass.service_speed_kn || 14.0;
    const seaDays = distanceNm / (speed * 24.0);
    const basePortDays =
      (config.default_load_days || 2) + (config.default_disch_days || 2);
    const baseTotalVoyageDays = seaDays + basePortDays;

    const coeff = config.hire_coefficients[subIndex] || { slope: 8.0, intercept: 800 };
    const baseHirePerDay = Math.max(0, baseIndex * coeff.slope + coeff.intercept);
    const baseTotalHire = baseHirePerDay * baseTotalVoyageDays;

    const vlsfoPrice =
      (config.baseline_market.crude_usd_bbl || 106.33) * (config.VLSFO_FACTOR || 6.5);
    const seaBurn = seaDays * (vClass.consumption_laden_mt_per_day || 28.0);
    const basePortBurn = basePortDays * (vClass.consumption_port_mt_per_day || 3.0);
    const baseBunkerCost = (seaBurn + basePortBurn) * vlsfoPrice;
    const portCharges = config.port_charges?.[vClass.class] || 30000;
    const miscCost = config.misc_voyage_usd || 5000;

    const baseSubtotal = baseTotalHire + baseBunkerCost + portCharges + miscCost;
    const baseFreightUsd =
      baseSubtotal * (1 + (config.insurance_rate || 0.005) + (config.address_commission || 0.0125));
    const baseFreightPerTonneInr = (baseFreightUsd / parcelTonnes) * baseUsdInr;
    const baseCommodityPerTonneInr = baseCommodity * baseUsdInr;
    const baseLandedInr = baseFreightPerTonneInr + baseCommodityPerTonneInr;

    // 2. SIMULATED CALCULATION (Using live slider deltas)
    // Allow raw index to calculate without pre-clamping to test extreme boundary conditions
    const simIndexRaw = baseIndex * (1 + freightDeltaPct / 100.0);
    const simUsdInr = Math.max(1, baseUsdInr * (1 + usdinrDeltaPct / 100.0));
    const simCommodityRaw = baseCommodity * (1 + commodityDeltaPct / 100.0);

    const extraPortDays = congestionHours / 24.0;
    const simPortDays = basePortDays + extraPortDays;
    const simTotalVoyageDays = seaDays + simPortDays;

    const simHirePerDayRaw = simIndexRaw * coeff.slope + coeff.intercept;
    const simTotalHireRaw = simHirePerDayRaw * simTotalVoyageDays;

    const simPortBurn = simPortDays * (vClass.consumption_port_mt_per_day || 3.0);
    const simBunkerCostRaw = (seaBurn + simPortBurn) * vlsfoPrice;

    const simSubtotalRaw = simTotalHireRaw + simBunkerCostRaw + portCharges + miscCost;
    const simFreightUsdRaw =
      simSubtotalRaw * (1 + (config.insurance_rate || 0.005) + (config.address_commission || 0.0125));
    const rawSimFreightPerTonneInr = (simFreightUsdRaw / parcelTonnes) * simUsdInr;
    const rawSimCommodityPerTonneInr = simCommodityRaw * simUsdInr;
    const rawSimLandedInr = rawSimFreightPerTonneInr + rawSimCommodityPerTonneInr;

    // CLAMP: If computed landed cost drops below zero or any line item goes negative,
    // display as ₹0 with a subtle "below model range" note.
    const isFreightBelowRange = rawSimFreightPerTonneInr < 0;
    const isCommodityBelowRange = rawSimCommodityPerTonneInr < 0;
    const isLandedBelowRange = rawSimLandedInr < 0;
    const isBelowRange = isFreightBelowRange || isCommodityBelowRange || isLandedBelowRange;

    const simFreightPerTonneInr = Math.max(0, rawSimFreightPerTonneInr);
    const simCommodityPerTonneInr = Math.max(0, rawSimCommodityPerTonneInr);
    const simLandedInr = Math.max(0, rawSimLandedInr);

    const deltaInr = simLandedInr - baseLandedInr;
    const deltaPct = baseLandedInr > 0 ? (deltaInr / baseLandedInr) * 100 : 0;

    const freightDeltaInr = simFreightPerTonneInr - baseFreightPerTonneInr;
    const commodityDeltaInr = simCommodityPerTonneInr - baseCommodityPerTonneInr;
    const congestionImpactInr = ((simTotalHireRaw - baseTotalHire) / parcelTonnes) * simUsdInr;

    return {
      vClass,
      subIndex,
      baseIndex,
      simIndex: Math.max(0, simIndexRaw),
      baseUsdInr,
      simUsdInr,
      baseCommodity,
      simCommodity: Math.max(0, simCommodityRaw),
      baseLandedInr,
      simLandedInr,
      deltaInr,
      deltaPct,
      freightDeltaInr,
      commodityDeltaInr,
      congestionImpactInr,
      baseFreightPerTonneInr,
      simFreightPerTonneInr,
      baseCommodityPerTonneInr,
      simCommodityPerTonneInr,
      isFreightBelowRange,
      isCommodityBelowRange,
      isLandedBelowRange,
      isBelowRange,
      extraPortDays,
    };
  }, [
    config,
    selectedClass,
    freightDeltaPct,
    usdinrDeltaPct,
    congestionHours,
    commodityDeltaPct,
  ]);

  const resetSliders = () => {
    setFreightDeltaPct(0);
    setUsdinrDeltaPct(0);
    setCongestionHours(0);
    setCommodityDeltaPct(0);
  };

  const applyScenario = (f: number, fx: number, cong: number, c: number) => {
    setFreightDeltaPct(f);
    setUsdinrDeltaPct(fx);
    setCongestionHours(cong);
    setCommodityDeltaPct(c);
  };

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col p-4 md:p-6 overflow-y-auto space-y-6">
        <div className="mx-auto max-w-6xl w-full space-y-6">
          {/* ── Breadcrumb ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#1f1f23] pb-4">
            <div className="flex items-center gap-3">
              <Link
                href="/decision"
                className="flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-blue-400 transition"
              >
                <span>&larr; DECISION ENGINE</span>
              </Link>
              <span className="text-zinc-600">/</span>
              <span className="text-xs font-mono text-zinc-300 font-semibold uppercase">
                WHAT-IF SENSITIVITY SIMULATOR
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-950/60 border border-blue-800/60 px-2.5 py-0.5 font-mono text-[10px] text-blue-400 font-semibold">
                PURE CLIENT RECOMPUTE &middot; ZERO LATENCY
              </span>
            </div>
          </div>

          {/* ── Page Header & Differentiator Banner ── */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-[#ededed]">
                What-If Sensitivity Simulator
              </h1>
              <button
                onClick={resetSliders}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272a] bg-[#161619] px-3 py-1.5 font-mono text-xs text-zinc-300 hover:bg-[#202026] hover:text-white transition cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-zinc-400" />
                <span>Reset to Baseline</span>
              </button>
            </div>

            {/* Differentiator Banner */}
            <div className="rounded-xl border border-blue-900/40 bg-gradient-to-r from-blue-950/40 via-blue-950/20 to-[#121214] p-3.5 flex items-center justify-between gap-4 font-mono text-xs">
              <div className="flex items-center gap-2.5 text-zinc-200">
                <Sparkles className="h-4 w-4 text-blue-400 shrink-0" />
                <span>
                  <strong className="text-blue-300">Live Sensitivity Engine:</strong> Watch what
                  happens to your landed ₹/tonne if freight rises 15% and Paradip congestion adds
                  24h in real time.
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-1 text-[11px] text-zinc-400 shrink-0">
                <span className="text-zinc-500">Coefficients source:</span>
                <code>GET /engine/config</code>
              </div>
            </div>
          </div>

          {/* ── Preset Shock Scenarios ── */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="text-zinc-500 text-[11px] uppercase pr-1">Pre-built Shocks:</span>
            <button
              onClick={() => applyScenario(15, 0, 24, 0)}
              className="rounded-lg border border-[#27272a] bg-[#151518] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-blue-500 hover:text-blue-400 transition"
            >
              Freight +15% &amp; Congestion +24h
            </button>
            <button
              onClick={() => applyScenario(25, 5, 0, 0)}
              className="rounded-lg border border-[#27272a] bg-[#151518] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-blue-500 hover:text-blue-400 transition"
            >
              Freight Rally (+25%) &amp; USD +5%
            </button>
            <button
              onClick={() => applyScenario(0, 0, 48, 0)}
              className="rounded-lg border border-[#27272a] bg-[#151518] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-blue-500 hover:text-blue-400 transition"
            >
              Severe Berth Queue (+48h)
            </button>
            <button
              onClick={() => applyScenario(0, 0, 0, 15)}
              className="rounded-lg border border-[#27272a] bg-[#151518] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-blue-500 hover:text-blue-400 transition"
            >
              Coal Spike (+15% FOB)
            </button>
          </div>

          {/* ── Main Simulator Grid: Sliders on Left, Real-Time Impact on Right ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* ── Left Column: Interactive Sliders (7 Cols) ── */}
            <div className="lg:col-span-7 space-y-4 rounded-xl border border-[#1f1f23] bg-[#121214] p-5 shadow-lg">
              {/* Vessel Class Switcher */}
              <div className="space-y-2 border-b border-[#1f1f23] pb-4">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400 font-medium uppercase">Vessel Class Sizing</span>
                  <span className="text-blue-400 font-semibold">{selectedClass}</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5 font-mono text-xs">
                  {["Handysize", "Supramax", "Panamax", "Kamsarmax", "Capesize"].map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedClass(c)}
                      className={`rounded-lg py-1.5 px-1 text-center font-medium transition ${
                        selectedClass === c
                          ? "bg-blue-600 text-white font-semibold shadow-xs"
                          : "bg-[#161619] text-zinc-400 hover:bg-[#1f1f23] hover:text-[#ededed]"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Slider 1: Freight Index */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
                    <span>Freight Index Shock (Baltic {computeSimulation?.subIndex})</span>
                  </div>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      freightDeltaPct > 0
                        ? "text-rose-400 bg-rose-950/40"
                        : freightDeltaPct < 0
                          ? "text-emerald-400 bg-emerald-950/40"
                          : "text-zinc-300 bg-zinc-800"
                    }`}
                  >
                    {freightDeltaPct >= 0 ? "+" : ""}
                    {freightDeltaPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  step="1"
                  value={freightDeltaPct}
                  onChange={(e) => setFreightDeltaPct(Number(e.target.value))}
                  className="w-full h-1.5 bg-[#27272a] rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>-50% (Depression)</span>
                  <span>Baseline (0%)</span>
                  <span>+50% (Rally)</span>
                </div>
              </div>

              {/* Slider 2: Port Congestion Delay */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                    <span>Discharge Port Delay / Anchorage Queue</span>
                  </div>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      congestionHours > 0
                        ? "text-amber-400 bg-amber-950/40"
                        : "text-zinc-300 bg-zinc-800"
                    }`}
                  >
                    +{congestionHours}h ({computeSimulation?.extraPortDays.toFixed(1)}d)
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="120"
                  step="6"
                  value={congestionHours}
                  onChange={(e) => setCongestionHours(Number(e.target.value))}
                  className="w-full h-1.5 bg-[#27272a] rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>+0h (Normal queue)</span>
                  <span>+48h (Berth hold)</span>
                  <span>+120h (Severe crisis)</span>
                </div>
              </div>

              {/* Slider 3: USD / INR FX */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                    <span>USD / INR Exchange Rate Shift</span>
                  </div>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      usdinrDeltaPct > 0
                        ? "text-rose-400 bg-rose-950/40"
                        : usdinrDeltaPct < 0
                          ? "text-emerald-400 bg-emerald-950/40"
                          : "text-zinc-300 bg-zinc-800"
                    }`}
                  >
                    {usdinrDeltaPct >= 0 ? "+" : ""}
                    {usdinrDeltaPct}% (₹{computeSimulation?.simUsdInr.toFixed(2)})
                  </span>
                </div>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="0.5"
                  value={usdinrDeltaPct}
                  onChange={(e) => setUsdinrDeltaPct(Number(e.target.value))}
                  className="w-full h-1.5 bg-[#27272a] rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>-20% (INR Strong)</span>
                  <span>₹83.21</span>
                  <span>+20% (INR Weak)</span>
                </div>
              </div>

              {/* Slider 4: Commodity Price */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <Flame className="h-3.5 w-3.5 text-orange-400" />
                    <span>Coking Coal FOB Price Shift</span>
                  </div>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      commodityDeltaPct > 0
                        ? "text-rose-400 bg-rose-950/40"
                        : commodityDeltaPct < 0
                          ? "text-emerald-400 bg-emerald-950/40"
                          : "text-zinc-300 bg-zinc-800"
                    }`}
                  >
                    {commodityDeltaPct >= 0 ? "+" : ""}
                    {commodityDeltaPct}% (${computeSimulation?.simCommodity.toFixed(1)}/t)
                  </span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="1"
                  value={commodityDeltaPct}
                  onChange={(e) => setCommodityDeltaPct(Number(e.target.value))}
                  className="w-full h-1.5 bg-[#27272a] rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>-30%</span>
                  <span>$182.54/t</span>
                  <span>+30%</span>
                </div>
              </div>
            </div>

            {/* ── Right Column: Real-Time Landed Cost & Delta vs Baseline (5 Cols) ── */}
            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-xl border border-blue-900/40 bg-gradient-to-br from-[#121217] via-[#0f1015] to-[#0a0a0f] p-5 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-[#1f1f26] pb-3">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    RECALCULATED LANDED COST
                  </span>
                  <span className="rounded bg-blue-950/60 border border-blue-800/60 px-2 py-0.5 font-mono text-[10px] text-blue-400">
                    {selectedClass}
                  </span>
                </div>

                {/* Big Live Monospace Number */}
                <div className="space-y-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-4xl font-bold tracking-tight text-white">
                      ₹{Math.round(computeSimulation?.simLandedInr || 0).toLocaleString("en-IN")}
                    </span>
                    <span className="font-mono text-sm text-zinc-400">/ MT</span>
                    {computeSimulation?.isBelowRange && (
                      <span className="font-mono text-[11px] text-amber-400 bg-amber-950/50 border border-amber-800/50 px-2 py-0.5 rounded">
                        below model range
                      </span>
                    )}
                  </div>

                  {/* Clamp Note if dropped below range */}
                  {computeSimulation?.isBelowRange && (
                    <div className="font-mono text-[11px] text-amber-400/90 pt-0.5">
                      * Displayed as ₹0 &middot; input combination below model range
                    </div>
                  )}

                  {/* Delta vs Baseline Banner */}
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-[#1f1f23] bg-[#161619] p-3 font-mono text-xs">
                    <span className="text-zinc-400">Delta vs Baseline:</span>
                    <div className="flex items-center gap-1.5 font-bold">
                      {(computeSimulation?.deltaInr || 0) > 0 ? (
                        <span className="flex items-center text-rose-400">
                          <TrendingUp className="h-4 w-4 mr-0.5 inline" />
                          +₹{Math.round(computeSimulation?.deltaInr || 0).toLocaleString()} (
                          +{computeSimulation?.deltaPct.toFixed(1)}%)
                        </span>
                      ) : (computeSimulation?.deltaInr || 0) < 0 ? (
                        <span className="flex items-center text-emerald-400">
                          <TrendingDown className="h-4 w-4 mr-0.5 inline" />
                          -₹{Math.round(Math.abs(computeSimulation?.deltaInr || 0)).toLocaleString()} (
                          {computeSimulation?.deltaPct.toFixed(1)}%)
                        </span>
                      ) : (
                        <span className="text-zinc-400">&plusmn;₹0 (0.0%)</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Component Delta Decomposition */}
                <div className="space-y-2 border-t border-[#1f1f26] pt-3 font-mono text-xs">
                  <div className="text-[11px] text-zinc-500 uppercase font-semibold">
                    Cost Drivers Breakdown:
                  </div>

                  <div className="flex items-center justify-between text-zinc-300">
                    <span className="text-zinc-400">Freight Delta:</span>
                    <span
                      className={
                        (computeSimulation?.freightDeltaInr || 0) >= 0
                          ? "text-rose-400"
                          : "text-emerald-400"
                      }
                    >
                      {(computeSimulation?.freightDeltaInr || 0) >= 0 ? "+" : ""}₹
                      {Math.round(computeSimulation?.freightDeltaInr || 0)} / MT
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-zinc-300">
                    <span className="text-zinc-400">Congestion Delay Impact:</span>
                    <span
                      className={
                        (computeSimulation?.congestionImpactInr || 0) > 0
                          ? "text-amber-400"
                          : "text-zinc-400"
                      }
                    >
                      +₹{Math.round(computeSimulation?.congestionImpactInr || 0)} / MT
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-zinc-300">
                    <span className="text-zinc-400">Commodity FOB Delta:</span>
                    <span
                      className={
                        (computeSimulation?.commodityDeltaInr || 0) >= 0
                          ? "text-rose-400"
                          : "text-emerald-400"
                      }
                    >
                      {(computeSimulation?.commodityDeltaInr || 0) >= 0 ? "+" : ""}₹
                      {Math.round(computeSimulation?.commodityDeltaInr || 0)} / MT
                    </span>
                  </div>
                </div>

                {/* Return to Decision Engine Link */}
                <div className="border-t border-[#1f1f26] pt-3">
                  <Link
                    href={`/decision?klass=${selectedClass}&dest=paradip`}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-mono text-xs font-semibold text-white transition hover:bg-blue-500 shadow-md"
                  >
                    <span>Commit Scenarios in Decision Engine &rarr;</span>
                  </Link>
                </div>
              </div>

              {/* Simulated Absolute Line Items Card */}
              <div className="rounded-xl border border-[#1f1f23] bg-[#121214] p-4 font-mono text-xs space-y-2 text-zinc-400">
                <div className="flex items-center justify-between text-[11px] text-zinc-500 uppercase font-semibold">
                  <span>Simulated Line Items (Absolute):</span>
                  <span className="text-zinc-300">{selectedClass}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Simulated Freight:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-200 font-semibold">
                      ₹{Math.round(computeSimulation?.simFreightPerTonneInr || 0).toLocaleString()}/t
                    </span>
                    {computeSimulation?.isFreightBelowRange && (
                      <span className="text-[10px] text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40">
                        below model range
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span>Simulated Commodity:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-200 font-semibold">
                      ₹{Math.round(computeSimulation?.simCommodityPerTonneInr || 0).toLocaleString()}/t
                    </span>
                    {computeSimulation?.isCommodityBelowRange && (
                      <span className="text-[10px] text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40">
                        below model range
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center border-t border-[#1f1f26] pt-1.5">
                  <span className="text-zinc-300 font-medium">Simulated Landed:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white font-bold">
                      ₹{Math.round(computeSimulation?.simLandedInr || 0).toLocaleString()}/t
                    </span>
                    {computeSimulation?.isBelowRange && (
                      <span className="text-[10px] text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40">
                        below model range
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Baseline Reference Card */}
              <div className="rounded-xl border border-[#1f1f23] bg-[#121214] p-4 font-mono text-xs space-y-2 text-zinc-400">
                <div className="flex items-center justify-between text-[11px] text-zinc-500 uppercase font-semibold">
                  <span>Baseline Assumptions (Unshocked):</span>
                  <span>50,000 MT Parcel</span>
                </div>
                <div className="flex justify-between">
                  <span>Baseline Landed:</span>
                  <span className="text-[#ededed] font-semibold">
                    ₹{Math.round(computeSimulation?.baseLandedInr || 16009).toLocaleString()}/t
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Baseline Freight:</span>
                  <span className="text-zinc-300">
                    ₹{Math.round(computeSimulation?.baseFreightPerTonneInr || 788).toLocaleString()}/t
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Baseline Commodity:</span>
                  <span className="text-zinc-300">
                    ₹{Math.round(computeSimulation?.baseCommodityPerTonneInr || 15189).toLocaleString()}/t
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
