"use client";

import React, { useEffect, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { LiveMap } from "../components/map/LiveMap";
import { VesselSidePanel } from "../components/map/VesselSidePanel";
import { TonnageListDrawer, OpenVessel } from "../components/map/TonnageListDrawer";
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

export default function Home() {
  const [ports, setPorts] = useState<PortData[]>([]);
  const [vessels, setVessels] = useState<VesselItem[]>([]);
  const [openVessels, setOpenVessels] = useState<OpenVessel[]>(SEEDED_OPEN_TONNAGE);
  const [selectedVessel, setSelectedVessel] = useState<VesselItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial ports & live vessels
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        // Fetch ports
        const pRes = await fetch(`${API_BASE}/ports`);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (!cancelled) setPorts(pData);
        }

        // Fetch live vessels
        const vRes = await fetch(`${API_BASE}/vessels/live`);
        if (vRes.ok) {
          const vData = await vRes.json();
          if (!cancelled) {
            const rawVessels: VesselItem[] = vData.vessels || [];
            setVessels(rawVessels);
          }
        }

        // Fetch open inbound vessels
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
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadData();
    // Poll live vessels every 12 seconds
    const interval = setInterval(loadData, 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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

  return (
    <AppShell>
      <div className="relative h-full w-full overflow-hidden bg-cx-bg">
        {/* Full-Height Leaflet Map */}
        <LiveMap
          ports={ports}
          vessels={vessels}
          selectedMmsi={selectedVessel?.mmsi ?? null}
          onSelectVessel={(v) => setSelectedVessel(v)}
          onSelectPort={(p) => console.log("Port selected:", p.name)}
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
        </div>

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
    </AppShell>
  );
}
