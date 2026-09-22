"use client";

import React, { useEffect, useState } from "react";
import {
  Compass,
  Navigation,
  Sliders,
  X,
  Play,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Layers,
  ArrowRight,
} from "lucide-react";
import type { RouteData } from "./RouteLayer";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

interface PortRef {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  max_draft_m?: number;
}

interface RouteSearchPanelProps {
  onRoutesLoaded: (routes: RouteData[], selectedClass: string) => void;
  onClearRoutes: () => void;
  activeRoutes: RouteData[];
  initialLoadPort?: string;
  initialDestPort?: string;
  initialClass?: string;
  initialCommodity?: string;
  initialTonnes?: number;
}

const DEFAULT_LOAD_PORTS: PortRef[] = [
  { id: "hay_point", name: "Hay Point (AU)" },
  { id: "port_hedland", name: "Port Hedland (AU)" },
  { id: "dampier", name: "Dampier (AU)" },
  { id: "newcastle", name: "Newcastle (AU)" },
  { id: "gladstone", name: "Gladstone (AU)" },
  { id: "richards_bay", name: "Richards Bay (ZA)" },
];

const DEFAULT_DEST_PORTS: PortRef[] = [
  { id: "paradip", name: "Paradip", max_draft_m: 14.5 },
  { id: "visakhapatnam", name: "Visakhapatnam", max_draft_m: 16.5 },
  { id: "gangavaram", name: "Gangavaram", max_draft_m: 18.5 },
  { id: "dhamra", name: "Dhamra", max_draft_m: 17.5 },
  { id: "gopalpur", name: "Gopalpur", max_draft_m: 12.5 },
  { id: "haldia", name: "Haldia", max_draft_m: 9.1 },
  { id: "sandheads", name: "Sandheads (Anchorage)", max_draft_m: 18.0 },
];

export function RouteSearchPanel({
  onRoutesLoaded,
  onClearRoutes,
  activeRoutes,
  initialLoadPort = "hay_point",
  initialDestPort = "paradip",
  initialClass = "all",
  initialCommodity = "coking_coal",
  initialTonnes = 50000,
}: RouteSearchPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(true);

  // Form inputs
  const [tonnes, setTonnes] = useState<number>(initialTonnes);
  const [commodity, setCommodity] = useState<string>(initialCommodity);
  const [loadPort, setLoadPort] = useState<string>(initialLoadPort);
  const [selectedDests, setSelectedDests] = useState<string[]>([initialDestPort]);
  const [vesselClass, setVesselClass] = useState<string>(initialClass);

  // Reference data
  const [loadPorts, setLoadPorts] = useState<PortRef[]>(DEFAULT_LOAD_PORTS);
  const [destPorts, setDestPorts] = useState<PortRef[]>(DEFAULT_DEST_PORTS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch reference ports from API
  useEffect(() => {
    async function fetchRef() {
      try {
        const [lRes, dRes] = await Promise.all([
          fetch(`${API_BASE}/load_ports`),
          fetch(`${API_BASE}/ports`),
        ]);
        if (lRes.ok) {
          const lData = await lRes.json();
          if (Array.isArray(lData) && lData.length > 0) setLoadPorts(lData);
        }
        if (dRes.ok) {
          const dData = await dRes.json();
          if (Array.isArray(dData) && dData.length > 0) setDestPorts(dData);
        }
      } catch (e) {
        // keep defaults
      }
    }
    fetchRef();
  }, []);

  // Update initial props when changed
  useEffect(() => {
    if (initialLoadPort) setLoadPort(initialLoadPort);
    if (initialDestPort) setSelectedDests([initialDestPort]);
    if (initialClass) setVesselClass(initialClass);
    if (initialCommodity) setCommodity(initialCommodity);
    if (initialTonnes) setTonnes(initialTonnes);
  }, [initialLoadPort, initialDestPort, initialClass, initialCommodity, initialTonnes]);

  const toggleDest = (id: string) => {
    setSelectedDests((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev; // keep at least one
        return prev.filter((d) => d !== id);
      }
      return [...prev, id];
    });
  };

  const handleComputeRoutes = async () => {
    if (selectedDests.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      if (selectedDests.length === 1) {
        // Single route query
        const url = `${API_BASE}/routes/compute?load=${encodeURIComponent(loadPort)}&dest=${encodeURIComponent(selectedDests[0])}&tonnes=${tonnes}&commodity=${encodeURIComponent(commodity)}&klass=${encodeURIComponent(vesselClass)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to compute sea route (${res.status})`);
        const data: RouteData = await res.json();
        onRoutesLoaded([data], vesselClass);
      } else {
        // Multi-route comparison query
        const destsParam = selectedDests.join(",");
        const url = `${API_BASE}/routes/compare?load=${encodeURIComponent(loadPort)}&dests=${encodeURIComponent(destsParam)}&tonnes=${tonnes}&commodity=${encodeURIComponent(commodity)}&klass=${encodeURIComponent(vesselClass)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to compare routes (${res.status})`);
        const dataList: RouteData[] = await res.json();
        onRoutesLoaded(dataList, vesselClass);
      }
      // Collapse panel on mobile, keep available
      if (window.innerWidth < 640) setIsOpen(false);
    } catch (err: any) {
      console.error("Route search failed", err);
      setError(err?.message || "Route calculation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ── Trigger Pill Button (Top Left) ── */}
      <div className="absolute top-14 left-3 z-[410] flex items-center gap-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs font-semibold backdrop-blur-md shadow-xl transition cursor-pointer ${
            activeRoutes.length > 0
              ? "border-blue-500 bg-blue-600 text-white shadow-blue-500/20"
              : "border-cx-border bg-cx-surface/95 text-cx-text hover:bg-cx-hover"
          }`}
        >
          <Compass className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span>ROUTE SIMULATOR</span>
          {activeRoutes.length > 0 && (
            <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
              {activeRoutes.length} {activeRoutes.length === 1 ? "lane" : "lanes"}
            </span>
          )}
        </button>

        {activeRoutes.length > 0 && (
          <button
            onClick={onClearRoutes}
            title="Clear all active route overlays"
            className="flex items-center gap-1 rounded-lg border border-cx-border bg-cx-surface/95 px-2.5 py-2 font-mono text-xs font-medium text-cx-text-secondary hover:text-rose-500 hover:bg-cx-hover backdrop-blur-md shadow-xl transition cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}
      </div>

      {/* ── Collapsible Floating Route Search Panel ── */}
      {isOpen && (
        <div className="absolute top-26 left-3 z-[420] w-[360px] max-w-[95vw] rounded-xl border border-cx-border bg-cx-surface/95 p-4 backdrop-blur-md shadow-2xl font-mono text-xs text-cx-text animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-cx-border pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <Navigation className="h-4 w-4 text-blue-500" />
              <span className="font-semibold text-sm">Sea Route Planner</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded p-1 text-cx-text-muted hover:text-cx-text hover:bg-cx-hover transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {error && (
            <div className="mb-3 flex items-center gap-2 rounded bg-rose-500/10 border border-rose-500/20 p-2 text-rose-500 text-[11px]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3">
            {/* Cargo Tonnes */}
            <div>
              <label className="text-[10px] text-cx-text-muted uppercase font-semibold block mb-1">
                Cargo Parcel Volume (Tonnes):
              </label>
              <input
                type="number"
                step="5000"
                min="10000"
                max="250000"
                value={tonnes}
                onChange={(e) => setTonnes(Number(e.target.value))}
                className="w-full rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            {/* Commodity */}
            <div>
              <label className="text-[10px] text-cx-text-muted uppercase font-semibold block mb-1">
                Commodity:
              </label>
              <select
                value={commodity}
                onChange={(e) => setCommodity(e.target.value)}
                className="w-full rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
              >
                <option value="coking_coal">Premium Coking Coal (Australia FOB)</option>
                <option value="iron_ore">Iron Ore 62% Fe (Australia/Brazil CFR)</option>
                <option value="thermal_coal">Thermal Coal (South Africa FOB)</option>
              </select>
            </div>

            {/* Load Port */}
            <div>
              <label className="text-[10px] text-cx-text-muted uppercase font-semibold block mb-1">
                Loading Port (Origin):
              </label>
              <select
                value={loadPort}
                onChange={(e) => setLoadPort(e.target.value)}
                className="w-full rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
              >
                {loadPorts.map((lp) => (
                  <option key={lp.id} value={lp.id}>
                    {lp.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Discharge Ports (Multi-select) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-cx-text-muted uppercase font-semibold">
                  Discharge Ports (Select for Comparison):
                </label>
                <span className="text-[10px] text-blue-500 font-semibold">
                  {selectedDests.length} selected
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                {destPorts.map((dp) => {
                  const isChecked = selectedDests.includes(dp.id);
                  return (
                    <button
                      type="button"
                      key={dp.id}
                      onClick={() => toggleDest(dp.id)}
                      className={`flex items-center justify-between px-2 py-1.5 rounded border text-[11px] transition text-left cursor-pointer ${
                        isChecked
                          ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold"
                          : "border-cx-border bg-cx-bg text-cx-text-secondary hover:bg-cx-hover"
                      }`}
                    >
                      <span className="truncate">{dp.name}</span>
                      {isChecked && <Check className="h-3 w-3 shrink-0 ml-1" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vessel Class Filter */}
            <div>
              <label className="text-[10px] text-cx-text-muted uppercase font-semibold block mb-1">
                Vessel Class:
              </label>
              <select
                value={vesselClass}
                onChange={(e) => setVesselClass(e.target.value)}
                className="w-full rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
              >
                <option value="all">All Classes (Auto-recommend optimal)</option>
                <option value="Supramax">Supramax (50k - 60k DWT)</option>
                <option value="Panamax">Panamax (65k - 80k DWT)</option>
                <option value="Kamsarmax">Kamsarmax (80k - 85k DWT)</option>
                <option value="Capesize">Capesize (120k - 200k DWT)</option>
                <option value="Handysize">Handysize (25k - 40k DWT)</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleComputeRoutes}
                disabled={loading || selectedDests.length === 0}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-mono text-xs font-semibold text-white transition hover:bg-blue-500 shadow-md shadow-blue-600/20 disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <Compass className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
                <span>
                  {loading
                    ? "Routing Sea Lanes…"
                    : selectedDests.length > 1
                    ? `Compare ${selectedDests.length} Routes`
                    : "Show Sea Route"}
                </span>
              </button>

              {activeRoutes.length > 0 && (
                <button
                  type="button"
                  onClick={onClearRoutes}
                  className="rounded-lg border border-cx-border px-3 py-2 text-xs font-medium text-cx-text-secondary hover:bg-cx-hover transition cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Summary Comparison Table Below Map (Docked Bottom Strip) ── */}
      {activeRoutes.length > 0 && (
        <div className="absolute bottom-14 left-3 right-3 sm:right-auto sm:max-w-4xl z-[400] rounded-xl border border-cx-border bg-cx-surface/95 backdrop-blur-md shadow-2xl font-mono text-xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-cx-border px-3.5 py-2 bg-cx-bg/60">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-500" />
              <span className="font-semibold text-cx-text">
                Sea Route Voyage Comparison Matrix ({activeRoutes.length} Lanes)
              </span>
            </div>
            <button
              onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
              className="rounded p-1 text-cx-text-muted hover:text-cx-text hover:bg-cx-hover transition cursor-pointer"
            >
              {isSummaryExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
          </div>

          {isSummaryExpanded && (
            <div className="overflow-x-auto max-h-56 p-2">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-cx-border text-[10px] text-cx-text-muted uppercase">
                    <th className="py-1.5 px-2">Destination</th>
                    <th className="py-1.5 px-2">Distance</th>
                    <th className="py-1.5 px-2">Transit (Sea / Total)</th>
                    <th className="py-1.5 px-2">Freight ₹/t</th>
                    <th className="py-1.5 px-2">Landed ₹/t</th>
                    <th className="py-1.5 px-2">Risk</th>
                    <th className="py-1.5 px-2">Draft Fit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cx-border/50 text-cx-text">
                  {activeRoutes.map((r, idx) => {
                    const sc =
                      (vesselClass && vesselClass !== "all"
                        ? r.scenarios.find(
                            (s) => s.vessel_class.toLowerCase() === vesselClass.toLowerCase()
                          )
                        : r.scenarios.find((s) => s.feasible)) || r.scenarios[0];
                    if (!sc) return null;

                    return (
                      <tr key={`summary-${r.dest_port.id}-${idx}`} className="hover:bg-cx-hover/40">
                        <td className="py-2 px-2 font-semibold">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-blue-500" />
                            <span>{r.dest_port.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-cx-text-secondary">
                          {r.distance_nm.toLocaleString()} NM
                        </td>
                        <td className="py-2 px-2">
                          <span className="font-semibold">{sc.sea_days}d</span>
                          <span className="text-cx-text-muted text-[10px]">
                            {" "}
                            ({sc.total_voyage_days}d)
                          </span>
                        </td>
                        <td className="py-2 px-2 font-semibold text-emerald-500 dark:text-emerald-400">
                          ₹{sc.freight_per_tonne_inr.toLocaleString()}
                        </td>
                        <td className="py-2 px-2 font-bold text-cx-text">
                          ₹{sc.landed_cost_per_tonne_inr.toLocaleString()}
                        </td>
                        <td className="py-2 px-2">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${
                              sc.risk_band === "low"
                                ? "bg-emerald-500/10 text-emerald-500"
                                : sc.risk_band === "medium"
                                ? "bg-amber-500/10 text-amber-500"
                                : "bg-rose-500/10 text-rose-500"
                            }`}
                          >
                            {sc.risk_band} ({sc.risk_score})
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          {sc.draft_clearance_m >= 0 ? (
                            <span className="text-emerald-500 font-semibold flex items-center gap-1">
                              <span>✓</span>
                              <span>+{sc.draft_clearance_m}m</span>
                            </span>
                          ) : (
                            <span className="text-rose-500 font-semibold flex items-center gap-1">
                              <span>⚠</span>
                              <span>{sc.draft_clearance_m}m</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
