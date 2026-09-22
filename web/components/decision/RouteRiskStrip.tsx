"use client";

import React, { useEffect, useState } from "react";
import { Wind, Waves, Compass } from "lucide-react";

interface Waypoint {
  stage: string;
  name: string;
  latitude: number;
  longitude: number;
  wind_kn: number;
  wave_m: number;
  risk: "green" | "amber" | "red" | string;
  status_label: string;
  cyclone_factor_applied?: boolean;
  notes?: string[];
}

interface RouteWeatherResponse {
  overall_risk: "green" | "amber" | "red" | string;
  estimated_delay_range: string;
  estimated_delay_summary: string;
  waypoints: Waypoint[];
  timestamp: string;
}

interface RouteRiskStripProps {
  loadPortId: string;
  destPortId: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export function RouteRiskStrip({ loadPortId, destPortId }: RouteRiskStripProps) {
  const [weatherData, setWeatherData] = useState<RouteWeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function fetchWeather() {
      try {
        const res = await fetch(
          `${API_BASE}/weather/route?load=${encodeURIComponent(
            loadPortId
          )}&dest=${encodeURIComponent(destPortId)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setWeatherData(data);
        }
      } catch (err) {
        console.error("Failed to load route weather:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchWeather();
    return () => {
      cancelled = true;
    };
  }, [loadPortId, destPortId]);

  if (loading && !weatherData) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-cx-border bg-cx-card p-3 font-mono text-xs text-cx-text-muted">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 animate-spin text-blue-500" />
          <span>Sampling sea-lane waypoints via Open-Meteo marine forecast…</span>
        </div>
      </div>
    );
  }

  if (!weatherData) return null;

  const getDotClass = (risk: string) => {
    if (risk === "red") return "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]";
    if (risk === "amber") return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]";
    return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]";
  };

  const getBadgeClass = (risk: string) => {
    if (risk === "red") return "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400";
    if (risk === "amber") return "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400";
    return "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400";
  };

  return (
    <div className="w-full rounded-xl border border-cx-border bg-cx-card p-3.5 space-y-2.5 shadow-md">
      {/* ── Top Bar: Title & Overall Delay Pill ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cx-border pb-2">
        <div className="flex items-center gap-2 font-mono text-xs">
          <Waves className="h-3.5 w-3.5 text-blue-500" />
          <span className="font-semibold uppercase tracking-wider text-cx-text text-[11px]">
            Sea Lane Weather &amp; Cyclone Corridor Risk
          </span>
          <span className="hidden sm:inline text-cx-border-subtle">&bull;</span>
          <span className="hidden sm:inline text-[10px] text-cx-text-secondary">
            Open-Meteo Marine Forecast &amp; Seasonal Cyclone Modeling
          </span>
        </div>

        {/* Estimated Delay Range Pill */}
        <div
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold ${getBadgeClass(
            weatherData.overall_risk
          )}`}
        >
          <span>Weather Delay:</span>
          <strong>{weatherData.estimated_delay_range}</strong>
          <span className="hidden md:inline text-cx-text-muted font-normal">
            ({weatherData.estimated_delay_summary})
          </span>
        </div>
      </div>

      {/* ── 4 Waypoint Cards Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-xs">
        {weatherData.waypoints.map((wp, idx) => {
          return (
            <div
              key={idx}
              className="flex flex-col justify-between rounded-lg border border-cx-border bg-cx-surface p-2.5 transition hover:border-cx-border-subtle hover:bg-cx-hover"
            >
              {/* Waypoint Stage Header */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-cx-text-muted uppercase tracking-tight">
                  {idx + 1}. {wp.stage}
                </span>
                <span className={`h-2 w-2 rounded-full ${getDotClass(wp.risk)}`} />
              </div>

              {/* Waypoint Location Name */}
              <div className="mt-1 font-semibold text-cx-text text-xs truncate">
                {wp.name}
              </div>

              {/* Wave & Wind Telemetry */}
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-cx-text-secondary border-t border-cx-border pt-1.5">
                <div className="flex items-center gap-1">
                  <Waves className="h-3 w-3 text-blue-500" />
                  <span>{wp.wave_m.toFixed(1)}m swell</span>
                </div>
                <div className="flex items-center gap-1">
                  <Wind className="h-3 w-3 text-cyan-500" />
                  <span>{wp.wind_kn.toFixed(0)} kn</span>
                </div>
              </div>

              {/* Cyclone Warning Note if applicable */}
              {wp.cyclone_factor_applied && (
                <div className="mt-1 text-[9px] text-amber-500 dark:text-amber-400 font-sans truncate">
                  &bull; Bay of Bengal cyclone season
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
