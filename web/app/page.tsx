"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "../components/layout/AppShell";
import { LiveMap } from "../components/map/LiveMap";
import { VesselSidePanel } from "../components/map/VesselSidePanel";
import { TonnageListDrawer, OpenVessel } from "../components/map/TonnageListDrawer";
import { RouteSearchPanel } from "../components/map/RouteSearchPanel";
import type { RouteData } from "../components/map/RouteLayer";
import type { PortData, VesselItem } from "../components/map/LiveMapInner";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

// ── Realistic seeded inbound tonnage fallback for demo day ────────────────
const SEEDED_OPEN_TONNAGE: OpenVessel[] = [
  {
    mmsi: 538008123,
    name: "MV ORE CANBERRA",
    inferred_class: "Capesize",
    dwt_capacity: 180000,
    draft: 17.8,
    destination: "PARADIP",
    eta: "4 days (Oct 02)",
    is_seeded: true,
  },
  {
    mmsi: 477625800,
    name: "CSSC ROTTERDAM",
    inferred_class: "Panamax",
    dwt_capacity: 76000,
    draft: 14.1,
    destination: "VISAKHAPATNAM",
    eta: "6 days (Oct 04)",
    is_seeded: true,
  },
  {
    mmsi: 249191000,
    name: "TOINY",
    inferred_class: "Kamsarmax",
    dwt_capacity: 82000,
    draft: 14.3,
    destination: "DHAMRA",
    eta: "7 days (Oct 05)",
    is_seeded: true,
  },
  {
    mmsi: 636025632,
    name: "HG VANCOUVER",
    inferred_class: "Supramax",
    dwt_capacity: 56000,
    draft: 12.8,
    destination: "PARADIP",
    eta: "9 days (Oct 07)",
    is_seeded: true,
  },
  {
    mmsi: 563048000,
    name: "EASTERN HARVEST",
    inferred_class: "Handysize",
    dwt_capacity: 38000,
    draft: 10.5,
    destination: "HALDIA",
    eta: "11 days (Oct 09)",
    is_seeded: true,
  },
];

function MapPageContent() {
  const searchParams = useSearchParams();
  const routeParam = searchParams.get("route");
  const commParam = searchParams.get("commodity");
  const tonnesParam = searchParams.get("tonnes");

  const [ports, setPorts] = useState<PortData[]>([]);
  const [vessels, setVessels] = useState<VesselItem[]>([]);
  const [openVessels, setOpenVessels] = useState<OpenVessel[]>(SEEDED_OPEN_TONNAGE);
  const [selectedVessel, setSelectedVessel] = useState<VesselItem | null>(null);

  // Sea Route state
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [selectedVesselClass, setSelectedVesselClass] = useState<string>("all");

  const [initialConfig, setInitialConfig] = useState<{
    load?: string;
    dest?: string;
    klass?: string;
    commodity?: string;
    tonnes?: number;
  }>({});

  // 1. Fetch initial ports & live vessels
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const pRes = await fetch(`${API_BASE}/ports`);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (!cancelled) setPorts(pData);
        }

        const vRes = await fetch(`${API_BASE}/vessels/live`);
        if (vRes.ok) {
          const vData = await vRes.json();
          if (!cancelled) {
            const rawVessels: VesselItem[] = vData.vessels || [];
            setVessels(rawVessels);
          }
        }

        const oRes = await fetch(`${API_BASE}/vessels/open`);
        if (oRes.ok) {
          const oData = await oRes.json();
          if (!cancelled) {
            const liveOpen = oData.vessels || [];
            if (liveOpen.length > 0) {
              const mapped: OpenVessel[] = liveOpen.map((v: any) => ({
                mmsi: v.mmsi,
                name: v.name || `MMSI ${v.mmsi}`,
                inferred_class: v.inferred_class || "Cargo",
                dwt_capacity: v.dwt_capacity,
                draft: v.draft,
                destination: v.destination || "INDIA",
                eta: v.eta ? new Date(v.eta).toLocaleDateString() : "Incoming",
                is_seeded: false,
              }));
              setOpenVessels(mapped);
            } else {
              setOpenVessels(SEEDED_OPEN_TONNAGE);
            }
          }
        }
      } catch (err) {
        console.warn("Could not load initial map data:", err);
      }
    }

    loadData();
    const interval = setInterval(loadData, 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // 2. Route persistence and URL parameter routing
  useEffect(() => {
    let load = "hay_point";
    let dest = "paradip";
    let klass = "all";
    let commodity = "coking_coal";
    let tonnes = 50000;
    let shouldAutoFetch = false;

    if (routeParam) {
      const parts = routeParam.split(",");
      if (parts[0]) load = parts[0];
      if (parts[1]) dest = parts[1];
      if (parts[2]) klass = parts[2];
      if (commParam) commodity = commParam;
      if (tonnesParam && !isNaN(Number(tonnesParam))) tonnes = Number(tonnesParam);
      shouldAutoFetch = true;
    } else {
      // Check localStorage for last computed route
      try {
        const cached = localStorage.getItem("cargox_last_route");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.load) load = parsed.load;
          if (parsed.dest) dest = parsed.dest;
          if (parsed.klass) klass = parsed.klass;
          if (parsed.commodity) commodity = parsed.commodity;
          if (parsed.tonnes) tonnes = parsed.tonnes;
          shouldAutoFetch = true;
        }
      } catch (e) {
        // ignore cache parse error
      }
    }

    setInitialConfig({ load, dest, klass, commodity, tonnes });

    if (shouldAutoFetch) {
      async function autoFetchRoute() {
        try {
          const url = `${API_BASE}/routes/compute?load=${encodeURIComponent(load)}&dest=${encodeURIComponent(dest)}&tonnes=${tonnes}&commodity=${encodeURIComponent(commodity)}&klass=${encodeURIComponent(klass)}`;
          const res = await fetch(url);
          if (res.ok) {
            const data: RouteData = await res.json();
            setRoutes([data]);
            setSelectedVesselClass(klass);
          }
        } catch (err) {
          console.warn("Auto-route fetch error", err);
        }
      }
      autoFetchRoute();
    }
  }, [routeParam, commParam, tonnesParam]);

  const handleSelectVesselByMmsi = (mmsi: number) => {
    const found = vessels.find((v) => v.mmsi === mmsi);
    if (found) {
      setSelectedVessel(found);
    } else {
      const seeded = SEEDED_OPEN_TONNAGE.find((v) => v.mmsi === mmsi);
      if (seeded) {
        setSelectedVessel({
          mmsi: seeded.mmsi,
          name: seeded.name,
          inferred_class: seeded.inferred_class,
          draft: seeded.draft,
          destination: seeded.destination,
          latitude: 18.5,
          longitude: 85.5,
          speed: 12.4,
          heading: 310,
        });
      }
    }
  };

  const handleRoutesLoaded = (loadedRoutes: RouteData[], klass: string) => {
    setRoutes(loadedRoutes);
    setSelectedVesselClass(klass);
    if (loadedRoutes.length > 0) {
      try {
        localStorage.setItem(
          "cargox_last_route",
          JSON.stringify({
            load: loadedRoutes[0].load_port.id,
            dest: loadedRoutes[0].dest_port.id,
            klass,
          })
        );
      } catch (e) {}
    }
  };

  const handleClearRoutes = () => {
    setRoutes([]);
    try {
      localStorage.removeItem("cargox_last_route");
    } catch (e) {}
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-cx-bg">
      {/* Full-Height Leaflet Map with RouteLayer */}
      <LiveMap
        ports={ports}
        vessels={vessels}
        selectedMmsi={selectedVessel?.mmsi ?? null}
        onSelectVessel={(v) => setSelectedVessel(v)}
        onSelectPort={(p) => console.log("Port selected:", p.name)}
        routes={routes}
        selectedVesselClass={selectedVesselClass}
      />

      {/* Floating Metrics Badge (Top Right) */}
      <div className="absolute top-3 right-3 z-30 hidden sm:flex items-center gap-2 rounded-lg border border-cx-border bg-cx-surface/90 px-3 py-1.5 backdrop-blur-md shadow-xl font-mono text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
          <span className="text-cx-text-secondary">PORTS:</span>
          <span className="font-semibold text-cx-text">{ports.length}</span>
        </div>
        <span className="text-cx-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-cx-text-secondary">LIVE AIS:</span>
          <span className="font-semibold text-emerald-500 dark:text-emerald-400">
            {vessels.length > 0 ? vessels.length : "SYNCING"}
          </span>
        </div>
        {routes.length > 0 && (
          <>
            <span className="text-cx-border">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-cx-text-secondary">ACTIVE LANE:</span>
              <span className="font-semibold text-blue-500 uppercase">
                {routes[0].load_port.name} → {routes[0].dest_port.name}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Collapsible Sea Route Planner & Matrix */}
      <RouteSearchPanel
        onRoutesLoaded={handleRoutesLoaded}
        onClearRoutes={handleClearRoutes}
        activeRoutes={routes}
        initialLoadPort={initialConfig.load}
        initialDestPort={initialConfig.dest}
        initialClass={initialConfig.klass}
        initialCommodity={initialConfig.commodity}
        initialTonnes={initialConfig.tonnes}
      />

      {/* Collapsible Tonnage List Drawer */}
      <TonnageListDrawer
        vessels={openVessels}
        onSelectVessel={handleSelectVesselByMmsi}
      />

      {/* Vessel Detail Side Panel */}
      <VesselSidePanel
        vessel={selectedVessel}
        onClose={() => setSelectedVessel(null)}
      />
    </div>
  );
}

export default function Home() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center font-mono text-xs text-cx-text-muted">
            Initializing Live Maritime Map & Routes…
          </div>
        }
      >
        <MapPageContent />
      </Suspense>
    </AppShell>
  );
}
