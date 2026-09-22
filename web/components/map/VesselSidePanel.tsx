"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Ship,
  Navigation,
  Anchor,
  Clock,
  Gauge,
  Maximize2,
  Sliders,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { SidePanel } from "../ui/SidePanel";

interface VesselData {
  mmsi: number;
  name?: string;
  imo?: number | null;
  callsign?: string | null;
  ship_type?: number | null;
  loa?: number | null;
  beam?: number | null;
  draft?: number | null;
  destination?: string | null;
  eta?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speed?: number | null;
  course?: number | null;
  heading?: number | null;
  nav_status?: number | null;
  inferred_class?: string | null;
  last_seen?: string | null;
  is_seeded?: boolean | number | null;
}

interface VesselSidePanelProps {
  vessel: VesselData | null;
  onClose: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export function VesselSidePanel({ vessel, onClose }: VesselSidePanelProps) {
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vessel?.mmsi) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchProfile() {
      try {
        const res = await fetch(`${API_BASE}/vessels/${vessel!.mmsi}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setProfile(data);
        } else {
          if (!cancelled) setProfile({ vessel, matched_class: null });
        }
      } catch {
        if (!cancelled) setProfile({ vessel, matched_class: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [vessel]);

  if (!vessel) return null;

  const currentVessel = profile?.vessel || vessel;
  const matchedClass = profile?.matched_class;

  const klass = currentVessel.inferred_class || "Handysize";
  // Decision query parameters for prefilled routing
  const decisionUrl = `/decision?klass=${encodeURIComponent(klass)}&mmsi=${currentVessel.mmsi}&dest=paradip`;

  const isSeeded = Boolean(currentVessel.is_seeded);

  return (
    <SidePanel
      isOpen={!!vessel}
      onClose={onClose}
      title={currentVessel.name || `MMSI ${currentVessel.mmsi}`}
      subtitle={`MMSI: ${currentVessel.mmsi}${currentVessel.imo ? ` • IMO: ${currentVessel.imo}` : ""}`}
      badge={
        <div className="flex items-center gap-1.5">
          {isSeeded && (
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-500 tracking-wider">
              SEEDED
            </span>
          )}
          {currentVessel.inferred_class ? (
            <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-500 font-semibold tracking-wider uppercase">
              {currentVessel.inferred_class}
            </span>
          ) : (
            <span className="rounded-full border border-cx-border bg-cx-hover px-2 py-0.5 font-mono text-[10px] text-cx-text-secondary">
              CARGO
            </span>
          )}
        </div>
      }
      footer={
        <div className="flex flex-col gap-2">
          <Link
            href={decisionUrl}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-mono text-xs font-semibold text-white transition hover:bg-blue-500 shadow-md shadow-blue-600/20"
          >
            <Sliders className="h-4 w-4" />
            <span>Evaluate in Decision Engine</span>
          </Link>
          <p className="text-center font-mono text-[10px] text-cx-text-muted">
            Prefills {klass} class & vessel telemetry into procurement matrix
          </p>
        </div>
      }
    >
      {/* ── Telemetry Grid ── */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-cx-border bg-cx-surface p-3">
          <div className="flex items-center gap-1.5 text-cx-text-secondary text-xs">
            <Gauge className="h-3.5 w-3.5 text-blue-500" />
            <span>Speed Over Ground</span>
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-cx-text">
            {currentVessel.speed !== null && currentVessel.speed !== undefined
              ? `${Number(currentVessel.speed).toFixed(1)} kn`
              : "--"}
          </div>
        </div>

        <div className="rounded-lg border border-cx-border bg-cx-surface p-3">
          <div className="flex items-center gap-1.5 text-cx-text-secondary text-xs">
            <Navigation className="h-3.5 w-3.5 text-cyan-500" />
            <span>Course / Heading</span>
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-cx-text">
            {currentVessel.heading !== null && currentVessel.heading !== undefined
              ? `${Math.round(currentVessel.heading)}°`
              : currentVessel.course !== null && currentVessel.course !== undefined
                ? `${Math.round(currentVessel.course)}°`
                : "--"}
          </div>
        </div>
      </div>

      {/* ── Voyage & Destination Card ── */}
      <div className="rounded-lg border border-cx-border bg-cx-surface p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-cx-text">
            <Anchor className="h-4 w-4 text-emerald-500" />
            <span>Reported Destination</span>
          </div>
          <span className="font-mono text-[11px] text-cx-text-secondary">AIS ETA</span>
        </div>

        <div className="flex items-baseline justify-between gap-2 border-t border-cx-border-subtle pt-2">
          <div className="font-mono text-sm font-semibold text-cx-text uppercase tracking-wide">
            {currentVessel.destination || "Destination not reported"}
          </div>
          <div className="font-mono text-xs text-cx-text-secondary">
            {currentVessel.eta
              ? new Date(currentVessel.eta).toLocaleDateString("en-IN", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "ETA not set"}
          </div>
        </div>

        <div className="font-mono text-[11px] text-cx-text-secondary">
          Position:{" "}
          <span className="text-cx-text font-medium">
            {currentVessel.latitude?.toFixed(4)}°, {currentVessel.longitude?.toFixed(4)}°
          </span>
        </div>
      </div>

      {/* ── Vessel Physical Dimensions ── */}
      <div className="rounded-lg border border-cx-border bg-cx-surface p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-cx-text-secondary">
            Physical Dimensions
          </span>
          <Maximize2 className="h-3.5 w-3.5 text-cx-text-muted" />
        </div>

        <div className="grid grid-cols-3 gap-2 font-mono text-center pt-1">
          <div className="rounded bg-cx-card p-2 border border-cx-border">
            <div className="text-[10px] text-cx-text-muted">LENGTH (LOA)</div>
            <div className="mt-0.5 text-sm font-semibold text-cx-text">
              {currentVessel.loa ? `${Math.round(currentVessel.loa)} m` : "--"}
            </div>
          </div>
          <div className="rounded bg-cx-card p-2 border border-cx-border">
            <div className="text-[10px] text-cx-text-muted">BEAM</div>
            <div className="mt-0.5 text-sm font-semibold text-cx-text">
              {currentVessel.beam ? `${Math.round(currentVessel.beam)} m` : "--"}
            </div>
          </div>
          <div className="rounded bg-cx-card p-2 border border-cx-border">
            <div className="text-[10px] text-cx-text-muted">MAX DRAFT</div>
            <div className="mt-0.5 text-sm font-semibold text-cx-text">
              {currentVessel.draft ? `${Number(currentVessel.draft).toFixed(1)} m` : "--"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Matched Dry Bulk Class Benchmark (vessel_classes.json) ── */}
      {matchedClass && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-500">
              {matchedClass.class} Class Specs
            </span>
            <span className="font-mono text-[10px] text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
              Index: {matchedClass.baltic_index}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono text-cx-text">
            <div>
              <span className="text-cx-text-muted">DWT Range: </span>
              <span>
                {(matchedClass.dwt_min / 1000).toFixed(0)}k–
                {(matchedClass.dwt_max / 1000).toFixed(0)}k t
              </span>
            </div>
            <div>
              <span className="text-cx-text-muted">Service Speed: </span>
              <span>{matchedClass.service_speed_kn} kn</span>
            </div>
            <div>
              <span className="text-cx-text-muted">Laden Burn: </span>
              <span>{matchedClass.consumption_laden_mt_per_day} mt/d</span>
            </div>
            <div>
              <span className="text-cx-text-muted">Ballast Burn: </span>
              <span>{matchedClass.consumption_ballast_mt_per_day} mt/d</span>
            </div>
          </div>

          {matchedClass.notes && (
            <p className="text-[11px] text-cx-text-secondary border-t border-blue-500/20 pt-2 italic">
              {matchedClass.notes}
            </p>
          )}
        </div>
      )}

      {/* Timestamp */}
      {currentVessel.last_seen && (
        <div className="flex items-center justify-between text-[10px] font-mono text-cx-text-muted pt-1">
          <span>Last AIS Signal:</span>
          <span>{new Date(currentVessel.last_seen).toISOString()}</span>
        </div>
      )}
    </SidePanel>
  );
}
