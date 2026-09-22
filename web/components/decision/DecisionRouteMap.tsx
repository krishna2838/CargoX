"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { Compass, Navigation, Radio } from "lucide-react";
import type { RouteData } from "../map/RouteLayer";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

interface DecisionRouteMapProps {
  loadPortId: string;
  destPortId: string;
  commodity: string;
  cargoTonnes: number;
  vesselClass: string;
  exampleVessel?: {
    name?: string;
    mmsi?: number;
    latitude?: number | null;
    longitude?: number | null;
    inferred_class?: string | null;
    eta?: string | null;
    speed?: number | null;
  } | null;
}

function MiniMapSkeleton() {
  return (
    <div className="relative flex h-[300px] w-full flex-col items-center justify-center rounded-xl border border-cx-border bg-cx-card overflow-hidden animate-pulse">
      <div
        className="absolute inset-0 opacity-15"
        style={{
          backgroundImage:
            "radial-gradient(var(--cx-border-subtle) 1px, transparent 1px), linear-gradient(to right, var(--cx-border) 1px, transparent 1px), linear-gradient(to bottom, var(--cx-border) 1px, transparent 1px)",
          backgroundSize: "30px 30px, 60px 60px, 60px 60px",
        }}
      />
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div className="absolute h-24 w-24 rounded-full border border-blue-500/20 animate-ping opacity-25" />
        <div className="absolute h-16 w-16 rounded-full border border-blue-500/30 animate-pulse" />
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/50">
          <Compass className="h-5 w-5 text-blue-500 animate-spin [animation-duration:8s]" />
        </div>
      </div>
      <p className="mt-3 font-mono text-xs text-cx-text-muted">
        Computing optimal sea route & nautical coordinates…
      </p>
    </div>
  );
}

const DynamicMiniMap = dynamic(
  () =>
    import("./DecisionRouteMapInner").then((mod) => mod.DecisionRouteMapInner),
  {
    ssr: false,
    loading: () => <MiniMapSkeleton />,
  }
);

export function DecisionRouteMap({
  loadPortId,
  destPortId,
  commodity,
  cargoTonnes,
  vesselClass,
  exampleVessel,
}: DecisionRouteMapProps) {
  const [route, setRoute] = useState<RouteData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchRoute() {
      setLoading(true);
      try {
        const url = `${API_BASE}/routes/compute?load=${encodeURIComponent(loadPortId)}&dest=${encodeURIComponent(destPortId)}&tonnes=${cargoTonnes}&commodity=${encodeURIComponent(commodity)}&klass=${encodeURIComponent(vesselClass)}`;
        const res = await fetch(url);
        if (res.ok && !cancelled) {
          const data: RouteData = await res.json();
          setRoute(data);
        }
      } catch (err) {
        console.warn("Failed fetching decision route map geometry", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRoute();
    return () => {
      cancelled = true;
    };
  }, [loadPortId, destPortId, commodity, cargoTonnes, vesselClass]);

  if (loading || !route) {
    return <MiniMapSkeleton />;
  }

  return (
    <div className="h-[300px] w-full rounded-xl border border-cx-border bg-cx-card overflow-hidden shadow-lg">
      <DynamicMiniMap
        route={route}
        vesselClass={vesselClass}
        loadPortId={loadPortId}
        destPortId={destPortId}
        commodity={commodity}
        cargoTonnes={cargoTonnes}
        exampleVessel={exampleVessel}
      />
    </div>
  );
}
