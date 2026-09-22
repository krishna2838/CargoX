"use client";

import React, { useEffect, useMemo } from "react";
import { Polyline, CircleMarker, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { Ship, Navigation, Anchor, Compass, Clock, AlertTriangle, ShieldCheck, Waves } from "lucide-react";
import type { VesselItem } from "./LiveMapInner";

export interface RouteScenario {
  vessel_class: string;
  feasible: boolean;
  sea_days: number;
  total_voyage_days: number;
  eta: string;
  freight_per_tonne_inr: number;
  landed_cost_per_tonne_inr: number;
  risk_band: string;
  risk_score: number;
  daily_hire_usd: number;
  bunker_cost_usd: number;
  draft_clearance_m: number;
}

export interface RouteData {
  route_geometry: {
    type: "LineString";
    coordinates: [number, number][]; // [lng, lat]
  };
  route_type?: string;
  distance_nm: number;
  load_port: {
    id: string;
    name: string;
    lat: number;
    lng: number;
  };
  dest_port: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    max_draft_m?: number;
  };
  scenarios: RouteScenario[];
  recommended_class: string;
  timing_signal: string;
  timing_reason: string;
  color?: string;
  example_vessel?: {
    name?: string;
    inferred_class?: string;
    latitude: number;
    longitude: number;
    eta?: string;
    sea_days_remaining?: number;
  };
}

interface RouteLayerProps {
  routes: RouteData[];
  vessels?: VesselItem[];
  selectedVesselClass?: string;
}

// ── Vessel Class Color Mapping ─────────────────────────────────────────────
const CLASS_COLORS: Record<string, string> = {
  Capesize: "#a855f7",   // Purple
  Panamax: "#3b82f6",    // Blue
  Kamsarmax: "#38bdf8",  // Sky
  Supramax: "#06b6d4",   // Cyan
  Handysize: "#10b981",  // Emerald
  default: "#3b82f6",
};

// Distinct colors for multi-route comparison
const COMPARISON_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#8b5cf6", // Purple
  "#06b6d4", // Cyan
  "#14b8a6", // Teal
];

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function RouteLayer({ routes, vessels = [], selectedVesselClass }: RouteLayerProps) {
  const map = useMap();

  // ── Auto fit bounds when routes change ───────────────────────────────────
  useEffect(() => {
    if (!routes || routes.length === 0) return;
    const allCoords = routes.flatMap((r) =>
      r.route_geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
    );
    if (allCoords.length > 0) {
      try {
        const bounds = L.latLngBounds(allCoords);
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8, animate: true });
      } catch (err) {
        console.warn("Failed fitting route bounds", err);
      }
    }
  }, [routes, map]);

  // ── Find Best Ship match within 150 NM of Primary Route ──────────────────
  const bestShipMatch = useMemo(() => {
    if (!routes || routes.length === 0 || !vessels || vessels.length === 0) return null;
    const primaryRoute = routes[0];
    const recClass = primaryRoute.recommended_class || "Supramax";
    const routeCoords = primaryRoute.route_geometry.coordinates; // [lng, lat]

    // Candidate vessels: prioritize vessels matching recommended class
    const matchingVessels = vessels.filter(
      (v) => v.inferred_class?.toLowerCase() === recClass.toLowerCase()
    );
    const candidateList = matchingVessels.length > 0 ? matchingVessels : vessels;

    let bestVessel: VesselItem | null = null;
    let minRouteDist = Infinity;
    let nearestPoint: [number, number] | null = null;

    for (const v of candidateList) {
      if (!v.latitude || !v.longitude) continue;
      for (const [cLng, cLat] of routeCoords) {
        const d = haversineNm(v.latitude, v.longitude, cLat, cLng);
        if (d < minRouteDist) {
          minRouteDist = d;
          bestVessel = v;
          nearestPoint = [cLat, cLng];
        }
      }
    }

    // Must be reasonably near the lane (< 180 NM)
    if (!bestVessel || !nearestPoint || minRouteDist > 180) {
      return null;
    }

    // Schedule estimation
    const distToLoad = haversineNm(
      bestVessel.latitude,
      bestVessel.longitude,
      primaryRoute.load_port.lat,
      primaryRoute.load_port.lng
    );
    const speed = bestVessel.speed && bestVessel.speed > 5 ? bestVessel.speed : 13.0;
    const daysToLoad = distToLoad / (speed * 24.0);
    const primaryScenario =
      primaryRoute.scenarios.find(
        (s) => s.vessel_class.toLowerCase() === recClass.toLowerCase()
      ) || primaryRoute.scenarios[0];
    const seaDays = primaryScenario?.sea_days || Math.round(primaryRoute.distance_nm / (speed * 24.0));

    const now = new Date();
    const loadDate = new Date(now.getTime() + daysToLoad * 86400000);
    const departDate = new Date(loadDate.getTime() + 2 * 86400000); // 2 days loading
    const arriveDate = new Date(departDate.getTime() + seaDays * 86400000);

    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const schedule = `Load: ${fmt(loadDate)} → Depart: ${fmt(departDate)} → Arrive ${primaryRoute.dest_port.name}: ${fmt(arriveDate)}`;

    return {
      vessel: bestVessel,
      distToRoute: Math.round(minRouteDist),
      nearestPoint,
      distToLoad: Math.round(distToLoad),
      daysToLoad: Number(daysToLoad.toFixed(1)),
      schedule,
    };
  }, [routes, vessels]);

  if (!routes || routes.length === 0) return null;

  const isComparison = routes.length > 1;

  return (
    <>
      {routes.map((route, rIdx) => {
        // Convert [lng, lat] from GeoJSON to [lat, lng] for Leaflet
        const latLngs = route.route_geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number]
        );

        if (latLngs.length < 2) return null;

        // Choose color
        const targetClass = selectedVesselClass && selectedVesselClass !== "all"
          ? selectedVesselClass
          : route.recommended_class;
        const routeColor = isComparison
          ? COMPARISON_COLORS[rIdx % COMPARISON_COLORS.length]
          : CLASS_COLORS[targetClass] || CLASS_COLORS.default;

        // Scenario for popup/details
        const activeScenario =
          route.scenarios.find(
            (s) => s.vessel_class.toLowerCase() === targetClass.toLowerCase()
          ) ||
          route.scenarios.find((s) => s.feasible) ||
          route.scenarios[0];

        // Midpoint for transit day badge
        const midIdx = Math.floor(latLngs.length / 2);
        const midPoint = latLngs[midIdx];
        const halfDays = Math.max(1, Math.round((activeScenario?.sea_days || 14) / 2));

        return (
          <React.Fragment key={`route-${route.load_port.id}-${route.dest_port.id}-${rIdx}`}>
            {/* ── Sea Route Polyline ── */}
            <Polyline
              positions={latLngs}
              pathOptions={{
                color: routeColor,
                weight: 3.5,
                dashArray: "8, 8",
                opacity: 0.95,
              }}
            >
              <Popup>
                <div className="p-2 space-y-1.5 font-mono text-xs text-cx-text min-w-[210px]">
                  <div className="flex items-center justify-between border-b border-cx-border pb-1 font-semibold">
                    <span style={{ color: routeColor }}>
                      {route.load_port.name} → {route.dest_port.name}
                    </span>
                    <span className="text-[10px] text-cx-text-muted">
                      {route.route_type === "great_circle_fallback" ? "DIRECT" : "SEAROUTE"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-cx-text-secondary">Distance:</span>
                    <span className="font-semibold">{route.distance_nm.toLocaleString()} NM</span>
                  </div>
                  {activeScenario && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-cx-text-secondary">Transit:</span>
                        <span>
                          {activeScenario.sea_days} sea ({activeScenario.total_voyage_days} total) d
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-cx-text-secondary">Freight P50:</span>
                        <span className="font-semibold text-emerald-500 dark:text-emerald-400">
                          ₹{activeScenario.freight_per_tonne_inr.toLocaleString()}/t
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-cx-text-secondary">Landed Cost:</span>
                        <span className="font-semibold text-cx-text">
                          ₹{activeScenario.landed_cost_per_tonne_inr.toLocaleString()}/t
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-cx-text-secondary">Risk:</span>
                        <span
                          className={`font-semibold capitalize ${
                            activeScenario.risk_band === "low"
                              ? "text-emerald-500"
                              : activeScenario.risk_band === "medium"
                              ? "text-amber-500"
                              : "text-rose-500"
                          }`}
                        >
                          {activeScenario.risk_band} ({activeScenario.risk_score})
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] pt-1 border-t border-cx-border">
                        <span className="text-cx-text-muted">Draft Clearance:</span>
                        <span
                          className={
                            activeScenario.draft_clearance_m >= 0
                              ? "text-emerald-500"
                              : "text-rose-500 font-semibold"
                          }
                        >
                          {activeScenario.draft_clearance_m >= 0 ? "+" : ""}
                          {activeScenario.draft_clearance_m} m
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </Popup>
            </Polyline>

            {/* ── Origin (Load Port) Green Marker ── */}
            <CircleMarker
              center={[route.load_port.lat, route.load_port.lng]}
              radius={7}
              pathOptions={{
                color: "#10b981",
                fillColor: "#10b981",
                fillOpacity: 0.9,
                weight: 2,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} permanent>
                <span className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-cx-surface/90 px-1 py-0.5 rounded shadow">
                  ⚓ {route.load_port.name} (Load)
                </span>
              </Tooltip>
            </CircleMarker>

            {/* ── Destination Port Red Marker ── */}
            <CircleMarker
              center={[route.dest_port.lat, route.dest_port.lng]}
              radius={7}
              pathOptions={{
                color: "#ef4444",
                fillColor: "#ef4444",
                fillOpacity: 0.9,
                weight: 2,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} permanent>
                <span className="font-mono text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-cx-surface/90 px-1 py-0.5 rounded shadow">
                  📍 {route.dest_port.name} (Draft: {route.dest_port.max_draft_m || 14.5}m)
                </span>
              </Tooltip>
            </CircleMarker>

            {/* ── Midpoint "Day X" Transit Marker ── */}
            {midPoint && (
              <CircleMarker
                center={midPoint}
                radius={4}
                pathOptions={{
                  color: routeColor,
                  fillColor: "#ffffff",
                  fillOpacity: 1,
                  weight: 2,
                }}
              >
                <Tooltip direction="right" offset={[6, 0]} permanent>
                  <span className="font-mono text-[9px] font-semibold text-cx-text bg-cx-surface/90 border border-cx-border px-1 py-0.5 rounded shadow">
                    Day {halfDays}
                  </span>
                </Tooltip>
              </CircleMarker>
            )}

            {/* ── Vessel Position on Route (if decision has example_vessel) ── */}
            {route.example_vessel && (
              <Marker
                position={[route.example_vessel.latitude, route.example_vessel.longitude]}
                icon={L.divIcon({
                  html: `
                    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
                      <div style="position: absolute; inset: 0; border-radius: 9999px; background-color: rgba(59,130,246,0.3); animation: ping 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
                      <div style="width: 14px; height: 14px; border-radius: 9999px; background-color: #3b82f6; border: 2px solid #ffffff; box-shadow: 0 0 10px rgba(59,130,246,0.8);"></div>
                    </div>
                  `,
                  className: "custom-pulsing-ship-icon",
                  iconSize: [28, 28],
                  iconAnchor: [14, 14],
                })}
              >
                <Popup>
                  <div className="p-2 font-mono text-xs text-cx-text">
                    <div className="font-bold text-blue-500">
                      {route.example_vessel.name || "ACTIVE BULKER"} — {route.example_vessel.inferred_class || "Supramax"}
                    </div>
                    <div className="text-[11px] text-cx-text-secondary mt-1">
                      ETA {route.dest_port.name}: {route.example_vessel.eta || activeScenario?.eta || "Inbound"}
                    </div>
                    <div className="text-[11px] text-cx-text-muted">
                      {route.example_vessel.sea_days_remaining || activeScenario?.sea_days} sea days remaining
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}
          </React.Fragment>
        );
      })}

      {/* ── Best Ship Tracking Highlight & Dotted Path ── */}
      {bestShipMatch && (
        <>
          {/* Dotted connector from vessel position to nearest route point */}
          <Polyline
            positions={[
              [bestShipMatch.vessel.latitude, bestShipMatch.vessel.longitude],
              bestShipMatch.nearestPoint,
            ]}
            pathOptions={{
              color: "#10b981",
              weight: 2,
              dashArray: "4, 6",
              opacity: 0.85,
            }}
          />

          {/* Glowing Beacon on Best Match Ship */}
          <Marker
            position={[bestShipMatch.vessel.latitude, bestShipMatch.vessel.longitude]}
            icon={L.divIcon({
              html: `
                <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;">
                  <div style="position: absolute; inset: -4px; border-radius: 9999px; border: 2px solid #10b981; animation: ping 2.5s infinite; opacity: 0.5;"></div>
                  <div style="position: absolute; inset: 0; border-radius: 9999px; background-color: rgba(16,185,129,0.25); box-shadow: 0 0 16px rgba(16,185,129,0.9);"></div>
                  <div style="width: 14px; height: 14px; border-radius: 9999px; background-color: #10b981; border: 2px solid #ffffff;"></div>
                </div>
              `,
              className: "best-match-vessel-marker",
              iconSize: [32, 32],
              iconAnchor: [16, 16],
            })}
          >
            <Tooltip direction="top" offset={[0, -18]} permanent>
              <div className="font-mono text-[10px] bg-cx-surface/95 border border-emerald-500/50 p-1.5 rounded-md shadow-xl text-cx-text max-w-[240px]">
                <div className="font-bold text-emerald-500 flex items-center gap-1">
                  <span>★ Best Match: {bestShipMatch.vessel.name || `MMSI ${bestShipMatch.vessel.mmsi}`}</span>
                </div>
                <div className="text-[9px] text-cx-text-secondary mt-0.5">
                  {bestShipMatch.vessel.inferred_class || "Cargo"} • {bestShipMatch.distToRoute} NM from route
                </div>
                <div className="text-[9px] text-cx-text font-semibold mt-1 border-t border-cx-border pt-0.5">
                  {bestShipMatch.schedule}
                </div>
              </div>
            </Tooltip>
          </Marker>
        </>
      )}

      {/* ── Multi-Route Comparison Legend (Bottom-Right Panel) ── */}
      {isComparison && (
        <div
          className="leaflet-bottom leaflet-right"
          style={{
            pointerEvents: "auto",
            margin: "0 16px 65px 0",
            zIndex: 400,
          }}
        >
          <div className="rounded-xl border border-cx-border bg-cx-surface/95 p-3 backdrop-blur-md shadow-2xl font-mono text-xs max-w-sm space-y-1.5">
            <div className="flex items-center justify-between border-b border-cx-border pb-1">
              <span className="font-semibold text-cx-text text-[11px] uppercase tracking-wider flex items-center gap-1">
                <Compass className="h-3.5 w-3.5 text-blue-500" />
                <span>Route Comparison ({routes.length} lanes)</span>
              </span>
            </div>
            <div className="space-y-1">
              {routes.map((r, idx) => {
                const col = COMPARISON_COLORS[idx % COMPARISON_COLORS.length];
                const sc =
                  r.scenarios.find((s) => s.feasible) || r.scenarios[0];
                return (
                  <div
                    key={`legend-${r.dest_port.id}-${idx}`}
                    className="flex items-center justify-between gap-3 text-[11px] hover:bg-cx-hover/40 px-1 py-0.5 rounded"
                  >
                    <div className="flex items-center gap-1.5 min-w-[90px]">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: col }}
                      />
                      <span className="font-semibold text-cx-text">
                        {r.dest_port.name}
                      </span>
                    </div>
                    <div className="text-right text-cx-text-secondary text-[10px]">
                      <span>₹{sc.landed_cost_per_tonne_inr.toLocaleString()}/t</span>
                      <span className="text-cx-text-muted"> • </span>
                      <span>{sc.total_voyage_days}d</span>
                      <span className="text-cx-text-muted"> • </span>
                      <span
                        className={`capitalize font-semibold ${
                          sc.risk_band === "low"
                            ? "text-emerald-500"
                            : sc.risk_band === "medium"
                            ? "text-amber-500"
                            : "text-rose-500"
                        }`}
                      >
                        {sc.risk_band}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
