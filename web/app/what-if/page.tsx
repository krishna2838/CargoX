"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import {
  TrendingUp,
  TrendingDown,
  RotateCcw,
  Sparkles,
  ArrowLeft,
  Clock,
  DollarSign,
  Flame,
  Sliders,
  MapPin,
  Package,
  Ship,
  Compass,
} from "lucide-react";

interface PortOption {
  id: string;
  name: string;
  country?: string;
  max_draft_m?: number;
}

interface EngineConfig {
  VLSFO_FACTOR: number;
  includes_ballast_leg?: boolean;
  hire_coefficients: Record<string, { slope: number; intercept: number; comment?: string }>;
  default_load_days: number;
  default_disch_days: number;
  port_charges?: Record<string, number>;
  port_charges_usd?: Record<string, number>;
  disch_days_override?: Record<string, number>;
  lighterage_surcharge_usd_per_t?: Record<string, number>;
  insurance_rate?: number;
  insurance_pct?: number;
  brokerage_pct?: number;
  address_commission?: number;
  misc_voyage_usd?: number;
  ports?: PortOption[];
  load_ports?: PortOption[];
  vessel_classes: Array<{
    class: string;
    baltic_index: string;
    dwt_min: number;
    dwt_max: number;
    service_speed_kn: number;
    ballast_speed_kn?: number;
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

  // ── Configurable Trade Lane & Cargo Parameters (Default: Hay Point -> Paradip 50k Coking Coal) ──
  const [loadPorts, setLoadPorts] = useState<PortOption[]>([]);
  const [destPorts, setDestPorts] = useState<PortOption[]>([]);
  const [selectedLoadPort, setSelectedLoadPort] = useState<string>("hay_point");
  const [selectedDestPort, setSelectedDestPort] = useState<string>("paradip");
  const [commodityType, setCommodityType] = useState<string>("coking_coal");
  const [parcelTonnes, setParcelTonnes] = useState<number>(50000);
  const [distanceNm, setDistanceNm] = useState<number>(4899);
  const [distanceLoading, setDistanceLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const [res, lRes, dRes] = await Promise.all([
          fetch(`${API_BASE}/engine/config`),
          fetch(`${API_BASE}/load_ports`),
          fetch(`${API_BASE}/ports`),
        ]);

        if (res.ok && !cancelled) {
          const data = await res.json();
          setConfig(data);
          if (data.load_ports && data.load_ports.length > 0) setLoadPorts(data.load_ports);
          if (data.ports && data.ports.length > 0) setDestPorts(data.ports);
        }
        if (lRes.ok && !cancelled) {
          const lData = await lRes.json();
          if (Array.isArray(lData) && lData.length > 0) setLoadPorts(lData);
        }
        if (dRes.ok && !cancelled) {
          const dData = await dRes.json();
          if (Array.isArray(dData) && dData.length > 0) setDestPorts(dData);
        }
      } catch (err) {
        console.error("Failed to load /engine/config or reference ports", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch updated sea distance and lane parameters when trade lane changes
  useEffect(() => {
    let cancelled = false;

    async function updateRouteDistance() {
      setDistanceLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/engine/cost?tonnes=${parcelTonnes}&load=${encodeURIComponent(
            selectedLoadPort
          )}&dest=${encodeURIComponent(
            selectedDestPort
          )}&klass=${encodeURIComponent(selectedClass)}&commodity=${encodeURIComponent(
            commodityType
          )}`
        );
        if (res.ok) {
          const data = await res.json();
          const dist = data?.cost_breakdown?.voyage?.distance_nm;
          if (!cancelled && typeof dist === "number" && dist > 0) {
            setDistanceNm(dist);
          }
        }
      } catch (err) {
        console.warn("Could not fetch route distance:", err);
      } finally {
        if (!cancelled) setDistanceLoading(false);
      }
    }

    updateRouteDistance();
    return () => {
      cancelled = true;
    };
  }, [selectedLoadPort, selectedDestPort, selectedClass, commodityType, parcelTonnes]);

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
    const ballastSpeed = vClass.ballast_speed_kn || speed;
    const ballastDays = config.includes_ballast_leg ? distanceNm / (ballastSpeed * 24.0) : 0;
    const dischDays = config.disch_days_override?.[selectedDestPort] || config.default_disch_days || 2;
    const basePortDays = (config.default_load_days || 2) + dischDays;
    const baseTotalVoyageDays = seaDays + ballastDays + basePortDays;

    const coeff = config.hire_coefficients[subIndex] || { slope: 8.0, intercept: 800 };
    const baseHirePerDay = Math.max(0, baseIndex * coeff.slope + coeff.intercept);
    const baseTotalHire = baseHirePerDay * baseTotalVoyageDays;

    const vlsfoPrice =
      (config.baseline_market.crude_usd_bbl || 106.33) * (config.VLSFO_FACTOR || 6.5);
    const seaBurn = seaDays * (vClass.consumption_laden_mt_per_day || 28.0);
    const ballastBurn = config.includes_ballast_leg
      ? ballastDays * (vClass.consumption_ballast_mt_per_day || (vClass.consumption_laden_mt_per_day || 28.0) * 0.8)
      : 0;
    const basePortBurn = basePortDays * (vClass.consumption_port_mt_per_day || 3.0);
    const baseBunkerCost = (seaBurn + ballastBurn + basePortBurn) * vlsfoPrice;
    const portCharges = config.port_charges_usd?.[selectedDestPort] || config.port_charges?.[vClass.class] || 45000;
    const lighteragePerT = config.lighterage_surcharge_usd_per_t?.[selectedDestPort] || 0.0;
    const lighterageUsd = lighteragePerT * parcelTonnes;

    const baseFreightUsd =
      baseTotalHire +
      baseBunkerCost +
      portCharges +
      lighterageUsd +
      (config.misc_voyage_usd || 10000);
    const baseFreightPerTonneUsd = baseFreightUsd / parcelTonnes;
    const baseFreightPerTonneInr = baseFreightPerTonneUsd * baseUsdInr;
    const baseCommodityPerTonneInr = baseCommodity * baseUsdInr;
    const baseLandedInr = baseFreightPerTonneInr + baseCommodityPerTonneInr;

    // 2. SIMULATED CALCULATION (With user slider shocks)
    const simIndex = Math.max(0, baseIndex * (1 + freightDeltaPct / 100.0));
    const simUsdInr = Math.max(1, baseUsdInr * (1 + usdinrDeltaPct / 100.0));
    const simCommodity = Math.max(0, baseCommodity * (1 + commodityDeltaPct / 100.0));

    const extraPortDays = Math.max(0, congestionHours / 24.0);
    const simTotalVoyageDays = baseTotalVoyageDays + extraPortDays;

    const simHirePerDay = Math.max(0, simIndex * coeff.slope + coeff.intercept);
    const simTotalHire = simHirePerDay * simTotalVoyageDays;

    const simPortBurn = (basePortDays + extraPortDays) * (vClass.consumption_port_mt_per_day || 3.0);
    const simBunkerCost = (seaBurn + ballastBurn + simPortBurn) * vlsfoPrice;

    const rawSimFreightUsd =
      simTotalHire +
      simBunkerCost +
      portCharges +
      lighterageUsd +
      (config.misc_voyage_usd || 10000);

    // Safeguard / Clamp against extreme slider combinations
    const isFreightBelowRange = rawSimFreightUsd < 0;
    const simFreightUsd = Math.max(0, rawSimFreightUsd);
    const simFreightPerTonneUsd = simFreightUsd / parcelTonnes;
    const simFreightPerTonneInr = simFreightPerTonneUsd * simUsdInr;

    const isCommodityBelowRange = simCommodity <= 0;
    const simCommodityPerTonneInr = simCommodity * simUsdInr;

    const rawSimLandedInr = simFreightPerTonneInr + simCommodityPerTonneInr;
    const isBelowRange = rawSimLandedInr <= 0 || isFreightBelowRange;
    const simLandedInr = Math.max(0, rawSimLandedInr);

    const deltaInr = simLandedInr - baseLandedInr;
    const deltaPct = baseLandedInr > 0 ? (deltaInr / baseLandedInr) * 100.0 : 0;

    // Cost driver sensitivity breakdown
    const freightDeltaInr = simFreightPerTonneInr - baseFreightPerTonneInr;
    const commodityDeltaInr = simCommodityPerTonneInr - baseCommodityPerTonneInr;
    const congestionImpactUsd =
      (simHirePerDay * extraPortDays + (extraPortDays * (vClass.consumption_port_mt_per_day || 3.0) * vlsfoPrice));
    const congestionImpactInr = (congestionImpactUsd / parcelTonnes) * simUsdInr;

    return {
      subIndex,
      baseIndex,
      simIndex,
      baseUsdInr,
      simUsdInr,
      baseCommodity,
      simCommodity,
      seaDays,
      basePortDays,
      simTotalVoyageDays,
      baseTotalHire,
      simTotalHire,
      baseBunkerCost,
      simBunkerCost,
      baseLandedInr,
      simLandedInr,
      deltaInr,
      deltaPct,
      baseFreightPerTonneInr,
      simFreightPerTonneInr,
      baseCommodityPerTonneInr,
      simCommodityPerTonneInr,
      extraPortDays,
      freightDeltaInr,
      commodityDeltaInr,
      congestionImpactInr,
      isBelowRange,
      isFreightBelowRange,
      isCommodityBelowRange,
    };
  }, [
    config,
    selectedClass,
    distanceNm,
    selectedDestPort,
    commodityType,
    parcelTonnes,
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

  const applyScenario = (f: number, u: number, c: number, com: number) => {
    setFreightDeltaPct(f);
    setUsdinrDeltaPct(u);
    setCongestionHours(c);
    setCommodityDeltaPct(com);
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-full w-full items-center justify-center font-mono text-xs text-cx-text-muted space-y-2 bg-cx-bg">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span>Loading Deterministic Cost Coefficients…</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col p-4 md:p-6 overflow-y-auto space-y-6 bg-cx-bg">
        <div className="mx-auto max-w-6xl w-full space-y-6">
          {/* ── Breadcrumb & Top Bar ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-cx-border pb-4">
            <div className="flex items-center gap-3">
              <Link
                href="/decision"
                className="flex items-center gap-1.5 text-xs font-mono text-cx-text-secondary hover:text-blue-500 transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>DECISION MATRIX</span>
              </Link>
              <span className="text-cx-border-subtle">/</span>
              <span className="text-xs font-mono text-cx-text font-semibold uppercase">
                SCENARIO SENSITIVITY SIMULATOR
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-500/10 border border-blue-500/30 px-2.5 py-0.5 font-mono text-[10px] text-blue-500 font-semibold">
                PURE CLIENT RECOMPUTE &middot; ZERO LATENCY
              </span>
            </div>
          </div>

          {/* ── Page Header & Differentiator Banner ── */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-cx-text">
                What-If Sensitivity Simulator
              </h1>
              <button
                onClick={resetSliders}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cx-border-subtle bg-cx-surface px-3 py-1.5 font-mono text-xs text-cx-text-secondary hover:bg-cx-hover hover:text-cx-text transition cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-cx-text-muted" />
                <span>Reset to Baseline</span>
              </button>
            </div>

            {/* Differentiator Banner */}
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3.5 flex items-center justify-between gap-4 font-mono text-xs">
              <div className="flex items-center gap-2.5 text-cx-text">
                <Sparkles className="h-4 w-4 text-blue-500 shrink-0" />
                <span>
                  <strong className="text-blue-500 font-semibold">Live Sensitivity Engine:</strong> Watch what
                  happens to your landed ₹/tonne if freight rises 15% and {destPorts.find((p) => p.id === selectedDestPort)?.name || "Paradip"} congestion adds
                  24h in real time.
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-1 text-[11px] text-cx-text-secondary shrink-0">
                <span className="text-cx-text-muted">Coefficients source:</span>
                <code>GET /engine/config</code>
              </div>
            </div>
          </div>

          {/* ── Trade Lane & Cargo Configurator Bar ── */}
          <div className="w-full rounded-xl border border-cx-border bg-cx-card p-4 sm:p-5 shadow-lg space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cx-border pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-500">
                  <Sliders className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-cx-text">
                    Trade Lane &amp; Commodity Parameters
                  </h2>
                  <p className="text-[11px] text-cx-text-secondary">
                    Configure origin port, discharge terminal, bulk commodity, and parcel volume
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 font-mono text-[11px] text-cx-text-muted">
                <Compass className={`h-3.5 w-3.5 text-blue-500 ${distanceLoading ? "animate-spin" : ""}`} />
                <span>Sea Distance:</span>
                <strong className="text-cx-text font-semibold">{distanceNm.toLocaleString()} NM</strong>
                <span className="hidden sm:inline text-cx-border">&bull;</span>
                <span className="hidden sm:inline text-[10px] text-cx-text-secondary">Searoute Channel</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 font-mono text-xs">
              {/* 1. Loading Port */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-cx-text">
                  <MapPin className="h-3.5 w-3.5 text-blue-500" />
                  <span>Loading Port (Export)</span>
                </label>
                <select
                  value={selectedLoadPort}
                  onChange={(e) => setSelectedLoadPort(e.target.value)}
                  className="w-full rounded-lg border border-cx-border-subtle bg-cx-surface px-3 py-2 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition cursor-pointer"
                >
                  {loadPorts.length > 0 ? (
                    loadPorts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.country ? `(${p.country})` : ""}
                      </option>
                    ))
                  ) : (
                    <option value="hay_point">Hay Point (Australia)</option>
                  )}
                </select>
              </div>

              {/* 2. Destination Port */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-cx-text">
                  <MapPin className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Discharge Port (India)</span>
                </label>
                <select
                  value={selectedDestPort}
                  onChange={(e) => setSelectedDestPort(e.target.value)}
                  className="w-full rounded-lg border border-cx-border-subtle bg-cx-surface px-3 py-2 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition cursor-pointer"
                >
                  {destPorts.length > 0 ? (
                    destPorts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.max_draft_m ? `(${p.max_draft_m}m draft)` : ""}
                      </option>
                    ))
                  ) : (
                    <option value="paradip">Paradip (14.5m draft)</option>
                  )}
                </select>
              </div>

              {/* 3. Commodity */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-cx-text">
                  <Package className="h-3.5 w-3.5 text-amber-500" />
                  <span>Bulk Commodity</span>
                </label>
                <select
                  value={commodityType}
                  onChange={(e) => setCommodityType(e.target.value)}
                  className="w-full rounded-lg border border-cx-border-subtle bg-cx-surface px-3 py-2 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition cursor-pointer"
                >
                  <option value="coking_coal">Coking Coal (Met Coal FOB)</option>
                  <option value="iron_ore">Iron Ore (62% Fe CFR/FOB)</option>
                  <option value="thermal_coal">Thermal Coal (Steam Coal)</option>
                </select>
              </div>

              {/* 4. Parcel Size */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-cx-text">
                  <Ship className="h-3.5 w-3.5 text-purple-500" />
                  <span>Parcel Volume (MT)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="10000"
                    max="250000"
                    step="5000"
                    value={parcelTonnes}
                    onChange={(e) => setParcelTonnes(Math.max(10000, Number(e.target.value) || 50000))}
                    className="w-full rounded-lg border border-cx-border-subtle bg-cx-surface px-3 py-2 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
                  />
                  <span className="pointer-events-none absolute right-3 top-2 font-mono text-xs text-cx-text-muted">
                    MT
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Preset Shock Scenarios ── */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="text-cx-text-muted text-[11px] uppercase pr-1">Pre-built Shocks:</span>
            <button
              onClick={() => applyScenario(15, 0, 24, 0)}
              className="rounded-lg border border-cx-border-subtle bg-cx-surface px-2.5 py-1 text-[11px] text-cx-text-secondary hover:border-blue-500 hover:text-blue-500 transition"
            >
              Freight +15% &amp; Congestion +24h
            </button>
            <button
              onClick={() => applyScenario(25, 5, 0, 0)}
              className="rounded-lg border border-cx-border-subtle bg-cx-surface px-2.5 py-1 text-[11px] text-cx-text-secondary hover:border-blue-500 hover:text-blue-500 transition"
            >
              Freight Rally (+25%) &amp; USD +5%
            </button>
            <button
              onClick={() => applyScenario(0, 0, 48, 0)}
              className="rounded-lg border border-cx-border-subtle bg-cx-surface px-2.5 py-1 text-[11px] text-cx-text-secondary hover:border-blue-500 hover:text-blue-500 transition"
            >
              Severe Berth Queue (+48h)
            </button>
            <button
              onClick={() => applyScenario(0, 0, 0, 15)}
              className="rounded-lg border border-cx-border-subtle bg-cx-surface px-2.5 py-1 text-[11px] text-cx-text-secondary hover:border-blue-500 hover:text-blue-500 transition"
            >
              Coal Spike (+15% FOB)
            </button>
          </div>

          {/* ── Main Simulator Grid: Sliders on Left, Real-Time Impact on Right ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* ── Left Column: Interactive Sliders (7 Cols) ── */}
            <div className="lg:col-span-7 space-y-4 rounded-xl border border-cx-border bg-cx-card p-5 shadow-lg">
              {/* Vessel Class Switcher */}
              <div className="space-y-2 border-b border-cx-border pb-4">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-cx-text-secondary font-medium uppercase">Vessel Class Sizing</span>
                  <span className="text-blue-500 font-semibold">{selectedClass}</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5 font-mono text-xs">
                  {["Handysize", "Supramax", "Panamax", "Kamsarmax", "Capesize"].map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedClass(c)}
                      className={`rounded-lg py-1.5 px-1 text-center font-medium transition ${
                        selectedClass === c
                          ? "bg-blue-600 text-white font-semibold shadow-xs"
                          : "bg-cx-surface text-cx-text-secondary hover:bg-cx-hover hover:text-cx-text"
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
                  <div className="flex items-center gap-1.5 text-cx-text">
                    <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
                    <span>Freight Index Shock (Baltic {computeSimulation?.subIndex})</span>
                  </div>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      freightDeltaPct > 0
                        ? "text-rose-500 bg-rose-500/10"
                        : freightDeltaPct < 0
                          ? "text-emerald-500 bg-emerald-500/10"
                          : "text-cx-text-secondary bg-cx-surface"
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
                  className="w-full h-1.5 bg-cx-border rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-cx-text-muted">
                  <span>-50% (Depression)</span>
                  <span>Baseline (0%)</span>
                  <span>+50% (Rally)</span>
                </div>
              </div>

              {/* Slider 2: Port Congestion Delay */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <div className="flex items-center gap-1.5 text-cx-text">
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    <span>Discharge Port Delay / Anchorage Queue</span>
                  </div>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      congestionHours > 0
                        ? "text-amber-500 bg-amber-500/10"
                        : "text-cx-text-secondary bg-cx-surface"
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
                  className="w-full h-1.5 bg-cx-border rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-cx-text-muted">
                  <span>+0h (Normal queue)</span>
                  <span>+48h (Berth hold)</span>
                  <span>+120h (Severe crisis)</span>
                </div>
              </div>

              {/* Slider 3: USD / INR FX */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <div className="flex items-center gap-1.5 text-cx-text">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                    <span>USD / INR Exchange Rate Shift</span>
                  </div>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      usdinrDeltaPct > 0
                        ? "text-rose-500 bg-rose-500/10"
                        : usdinrDeltaPct < 0
                          ? "text-emerald-500 bg-emerald-500/10"
                          : "text-cx-text-secondary bg-cx-surface"
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
                  className="w-full h-1.5 bg-cx-border rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-cx-text-muted">
                  <span>-20% (INR Strong)</span>
                  <span>₹83.21</span>
                  <span>+20% (INR Weak)</span>
                </div>
              </div>

              {/* Slider 4: Commodity Price */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <div className="flex items-center gap-1.5 text-cx-text">
                    <Flame className="h-3.5 w-3.5 text-orange-500" />
                    <span>Coking Coal FOB Price Shift</span>
                  </div>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      commodityDeltaPct > 0
                        ? "text-rose-500 bg-rose-500/10"
                        : commodityDeltaPct < 0
                          ? "text-emerald-500 bg-emerald-500/10"
                          : "text-cx-text-secondary bg-cx-surface"
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
                  className="w-full h-1.5 bg-cx-border rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <div className="flex justify-between text-[10px] font-mono text-cx-text-muted">
                  <span>-30%</span>
                  <span>$182.54/t</span>
                  <span>+30%</span>
                </div>
              </div>
            </div>

            {/* ── Right Column: Real-Time Landed Cost & Delta vs Baseline (5 Cols) ── */}
            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-xl border border-blue-500/30 bg-cx-card p-5 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-cx-border pb-3">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-cx-text-secondary">
                    RECALCULATED LANDED COST
                  </span>
                  <span className="rounded bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 font-mono text-[10px] text-blue-500">
                    {selectedClass}
                  </span>
                </div>

                {/* Big Live Monospace Number */}
                <div className="space-y-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-4xl font-bold tracking-tight text-cx-text">
                      ₹{Math.round(computeSimulation?.simLandedInr || 0).toLocaleString("en-IN")}
                    </span>
                    <span className="font-mono text-sm text-cx-text-muted">/ MT</span>
                    {computeSimulation?.isBelowRange && (
                      <span className="font-mono text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
                        below model range
                      </span>
                    )}
                  </div>

                  {/* Clamp Note if dropped below range */}
                  {computeSimulation?.isBelowRange && (
                    <div className="font-mono text-[11px] text-amber-500/90 pt-0.5">
                      * Displayed as ₹0 &middot; input combination below model range
                    </div>
                  )}

                  {/* Delta vs Baseline Banner */}
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-cx-border bg-cx-surface p-3 font-mono text-xs">
                    <span className="text-cx-text-secondary">Delta vs Baseline:</span>
                    <div className="flex items-center gap-1.5 font-bold">
                      {(computeSimulation?.deltaInr || 0) > 0 ? (
                        <span className="flex items-center text-rose-500">
                          <TrendingUp className="h-4 w-4 mr-0.5 inline" />
                          +₹{Math.round(computeSimulation?.deltaInr || 0).toLocaleString()} (
                          +{computeSimulation?.deltaPct.toFixed(1)}%)
                        </span>
                      ) : (computeSimulation?.deltaInr || 0) < 0 ? (
                        <span className="flex items-center text-emerald-500 dark:text-emerald-400">
                          <TrendingDown className="h-4 w-4 mr-0.5 inline" />
                          -₹{Math.round(Math.abs(computeSimulation?.deltaInr || 0)).toLocaleString()} (
                          {computeSimulation?.deltaPct.toFixed(1)}%)
                        </span>
                      ) : (
                        <span className="text-cx-text-secondary">&plusmn;₹0 (0.0%)</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Component Delta Decomposition */}
                <div className="space-y-2 border-t border-cx-border pt-3 font-mono text-xs">
                  <div className="text-[11px] text-cx-text-muted uppercase font-semibold">
                    Cost Drivers Breakdown:
                  </div>

                  <div className="flex items-center justify-between text-cx-text">
                    <span className="text-cx-text-secondary">Freight Delta:</span>
                    <span
                      className={
                        (computeSimulation?.freightDeltaInr || 0) >= 0
                          ? "text-rose-500"
                          : "text-emerald-500 dark:text-emerald-400"
                      }
                    >
                      {(computeSimulation?.freightDeltaInr || 0) >= 0 ? "+" : ""}₹
                      {Math.round(computeSimulation?.freightDeltaInr || 0)} / MT
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-cx-text">
                    <span className="text-cx-text-secondary">Congestion Delay Impact:</span>
                    <span
                      className={
                        (computeSimulation?.congestionImpactInr || 0) > 0
                          ? "text-amber-500"
                          : "text-cx-text-secondary"
                      }
                    >
                      +₹{Math.round(computeSimulation?.congestionImpactInr || 0)} / MT
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-cx-text">
                    <span className="text-cx-text-secondary">Commodity FOB Delta:</span>
                    <span
                      className={
                        (computeSimulation?.commodityDeltaInr || 0) >= 0
                          ? "text-rose-500"
                          : "text-emerald-500 dark:text-emerald-400"
                      }
                    >
                      {(computeSimulation?.commodityDeltaInr || 0) >= 0 ? "+" : ""}₹
                      {Math.round(computeSimulation?.commodityDeltaInr || 0)} / MT
                    </span>
                  </div>
                </div>

                {/* Return to Decision Engine Link */}
                <div className="border-t border-cx-border pt-3">
                  <Link
                    href={`/decision?klass=${selectedClass}&dest=${selectedDestPort}`}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-mono text-xs font-semibold text-white transition hover:bg-blue-500 shadow-md"
                  >
                    <span>Commit Scenarios in Decision Engine &rarr;</span>
                  </Link>
                </div>
              </div>

              {/* Simulated Absolute Line Items Card */}
              <div className="rounded-xl border border-cx-border bg-cx-card p-4 font-mono text-xs space-y-2 text-cx-text-secondary">
                <div className="flex items-center justify-between text-[11px] text-cx-text-muted uppercase font-semibold">
                  <span>Simulated Line Items (Absolute):</span>
                  <span className="text-cx-text font-medium">{selectedClass}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Simulated Freight:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-cx-text font-semibold">
                      ₹{Math.round(computeSimulation?.simFreightPerTonneInr || 0).toLocaleString()}/t
                    </span>
                    {computeSimulation?.isFreightBelowRange && (
                      <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                        below model range
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span>Simulated Commodity:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-cx-text font-semibold">
                      ₹{Math.round(computeSimulation?.simCommodityPerTonneInr || 0).toLocaleString()}/t
                    </span>
                    {computeSimulation?.isCommodityBelowRange && (
                      <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                        below model range
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center border-t border-cx-border pt-1.5">
                  <span className="text-cx-text font-medium">Simulated Landed:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-cx-text font-bold">
                      ₹{Math.round(computeSimulation?.simLandedInr || 0).toLocaleString()}/t
                    </span>
                    {computeSimulation?.isBelowRange && (
                      <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                        below model range
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Baseline Reference Card */}
              <div className="rounded-xl border border-cx-border bg-cx-card p-4 font-mono text-xs space-y-2 text-cx-text-secondary">
                <div className="flex items-center justify-between text-[11px] text-cx-text-muted uppercase font-semibold">
                  <span>Baseline ({loadPorts.find((p) => p.id === selectedLoadPort)?.name || "Hay Point"} &rarr; {destPorts.find((p) => p.id === selectedDestPort)?.name || "Paradip"}):</span>
                  <span>{parcelTonnes.toLocaleString()} MT Parcel</span>
                </div>
                <div className="flex justify-between">
                  <span>Baseline Landed:</span>
                  <span className="text-cx-text font-semibold">
                    ₹{Math.round(computeSimulation?.baseLandedInr || 16009).toLocaleString()}/t
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Baseline Freight:</span>
                  <span className="text-cx-text">
                    ₹{Math.round(computeSimulation?.baseFreightPerTonneInr || 788).toLocaleString()}/t
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Baseline Commodity:</span>
                  <span className="text-cx-text">
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
