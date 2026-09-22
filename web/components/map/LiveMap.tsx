"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { Compass, Radio } from "lucide-react";
import type { PortData, VesselItem } from "./LiveMapInner";

interface LiveMapProps {
  ports: PortData[];
  vessels: VesselItem[];
  selectedMmsi: number | null;
  onSelectVessel: (vessel: VesselItem) => void;
  onSelectPort?: (port: PortData) => void;
}

// ── Tactical skeleton placeholder to prevent flash ──────────
function MapSkeleton() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-cx-bg overflow-hidden animate-pulse">
      {/* Background nautical coordinate grid */}
      <div
        className="absolute inset-0 opacity-15"
        style={{
          backgroundImage:
            "radial-gradient(var(--cx-border-subtle) 1px, transparent 1px), linear-gradient(to right, var(--cx-border) 1px, transparent 1px), linear-gradient(to bottom, var(--cx-border) 1px, transparent 1px)",
          backgroundSize: "40px 40px, 80px 80px, 80px 80px",
        }}
      />

      {/* Radar rings animation */}
      <div className="relative flex h-48 w-48 items-center justify-center">
        <div className="absolute h-48 w-48 rounded-full border border-blue-500/10 animate-ping opacity-25" />
        <div className="absolute h-36 w-36 rounded-full border border-blue-500/20" />
        <div className="absolute h-24 w-24 rounded-full border border-blue-500/30" />
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
          <Compass className="h-6 w-6 text-blue-500 animate-spin [animation-duration:8s]" />
        </div>
      </div>

      {/* Telemetry Status text */}
      <div className="relative mt-6 flex flex-col items-center gap-1 text-center font-mono">
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-500">
          <Radio className="h-3.5 w-3.5 animate-pulse text-emerald-500" />
          <span>INITIALIZING MARITIME TELEMETRY MAP</span>
        </div>
        <p className="text-[11px] text-cx-text-muted">
          Loading maritime basemap tiles & AIS signals…
        </p>
      </div>
    </div>
  );
}

// Dynamically import Leaflet with SSR disabled
const DynamicLiveMap = dynamic(
  () => import("./LiveMapInner").then((mod) => mod.LiveMapInner),
  {
    ssr: false,
    loading: () => <MapSkeleton />,
  }
);

export function LiveMap(props: LiveMapProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <MapSkeleton />;
  }

  return <DynamicLiveMap {...props} />;
}
