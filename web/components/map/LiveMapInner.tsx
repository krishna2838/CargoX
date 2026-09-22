"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { Anchor, Compass, Maximize2, Navigation, Ship } from "lucide-react";

export interface PortData {
  id: string;
  name: string;
  lat: number;
  lng: number;
  max_draft_m: number;
  max_loa_m: number;
  avg_turnaround_hours?: number;
}

export interface VesselItem {
  mmsi: number;
  name?: string;
  ship_type?: number | null;
  loa?: number | null;
  beam?: number | null;
  draft?: number | null;
  destination?: string | null;
  eta?: string | null;
  latitude: number;
  longitude: number;
  speed?: number | null;
  course?: number | null;
  heading?: number | null;
  inferred_class?: string | null;
  last_seen?: string | null;
}

interface LiveMapInnerProps {
  ports: PortData[];
  vessels: VesselItem[];
  selectedMmsi: number | null;
  onSelectVessel: (vessel: VesselItem) => void;
  onSelectPort?: (port: PortData) => void;
}

// ── Color mappings for dry bulk vessel classes ─────────────────────────────
const CLASS_COLORS: Record<string, string> = {
  Capesize: "#c084fc",     // Purple
  Kamsarmax: "#38bdf8",    // Sky
  Panamax: "#3b82f6",      // Blue
  Supramax: "#06b6d4",     // Cyan
  Handysize: "#10b981",    // Emerald
  default: "#71717a",      // Zinc
};

function getVesselColor(inferredClass?: string | null): string {
  if (!inferredClass) return CLASS_COLORS.default;
  return CLASS_COLORS[inferredClass] || CLASS_COLORS.default;
}

// ── Custom SVG vessel marker icon factory ──────────────────────────────────
function createVesselIcon(vessel: VesselItem, isSelected: boolean): L.DivIcon {
  const color = getVesselColor(vessel.inferred_class);
  const heading =
    vessel.heading !== null && vessel.heading !== undefined && vessel.heading < 360
      ? vessel.heading
      : vessel.course || 0;
  const isMoving = (vessel.speed || 0) > 0.5;

  const size = isSelected ? 34 : 24;
  const half = size / 2;

  const html = `
    <div style="position: relative; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center;">
      ${
        isSelected
          ? `<div style="position: absolute; inset: -4px; border-radius: 9999px; border: 2px solid #3b82f6; box-shadow: 0 0 14px rgba(59,130,246,0.8); animation: pulse 2s infinite;"></div>`
          : ""
      }
      <div style="transform: rotate(${heading}deg); transform-origin: center; display: flex; align-items: center; justify-content: center; transition: transform 0.3s ease;">
        <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">
          <!-- Ship Hull Polygon -->
          <polygon points="12,2 18,18 12,15 6,18" fill="${color}" stroke="#0a0a0a" stroke-width="1.5" />
          ${
            isMoving
              ? `<circle cx="12" cy="11" r="1.75" fill="#ffffff" />`
              : `<rect x="10" y="10" width="4" height="4" fill="#0a0a0a" />`
          }
        </svg>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-vessel-icon",
    iconSize: [size, size],
    iconAnchor: [half, half],
    popupAnchor: [0, -half],
  });
}

// ── Custom SVG port marker icon factory ────────────────────────────────────
function createPortIcon(port: PortData): L.DivIcon {
  const html = `
    <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
      <div style="background-color: #1e1b4b; border: 1.5px solid #6366f1; border-radius: 9999px; padding: 4px; box-shadow: 0 0 10px rgba(99,102,241,0.5);">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="3"></circle>
          <line x1="12" y1="22" x2="12" y2="8"></line>
          <path d="M5 12H2a10 10 0 0 0 20 0h-3"></path>
        </svg>
      </div>
      <div style="margin-top: 2px; background-color: #0d0d0f; border: 1px solid #27272a; padding: 1px 4px; border-radius: 4px; font-family: monospace; font-size: 9px; font-weight: 600; color: #a5b4fc; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.6);">
        ${port.name} (${port.max_draft_m}m)
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-port-icon",
    iconSize: [60, 42],
    iconAnchor: [30, 14],
    popupAnchor: [0, -18],
  });
}

// ── Map view animator component ───────────────────────────────────────────
function MapController({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true });
  }, [center, zoom, map]);
  return null;
}

export function LiveMapInner({
  ports,
  vessels,
  selectedMmsi,
  onSelectVessel,
  onSelectPort,
}: LiveMapInnerProps) {
  // Filter and loading state
  const [classFilter, setClassFilter] = useState<string>("ALL");
  const [mapCenter, setMapCenter] = useState<[number, number]>([15.5, 87.0]);
  const [mapZoom, setMapZoom] = useState<number>(5);
  const [tilesLoaded, setTilesLoaded] = useState(false);

  // Safety fallback so skeleton never hangs if a single tile lags
  useEffect(() => {
    const timer = setTimeout(() => setTilesLoaded(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const filteredVessels = useMemo(() => {
    if (classFilter === "ALL") return vessels;
    return vessels.filter((v) => v.inferred_class === classFilter);
  }, [vessels, classFilter]);

  return (
    <div className="relative h-full w-full">
      {/* ── Dark Tile Painting Radar Skeleton Overlay ── */}
      {!tilesLoaded && (
        <div className="pointer-events-none absolute inset-0 z-[450] flex flex-col items-center justify-center bg-[#0a0a0a] transition-opacity duration-500">
          <div className="relative flex h-36 w-36 items-center justify-center">
            <div className="absolute h-36 w-36 rounded-full border border-blue-500/10 animate-ping opacity-25" />
            <div className="absolute h-24 w-24 rounded-full border border-blue-500/20 animate-pulse" />
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-950/60 border border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.5)]">
              <Compass className="h-6 w-6 text-blue-400 animate-spin [animation-duration:8s]" />
            </div>
          </div>
          <div className="mt-4 font-mono text-xs font-semibold text-blue-400 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>PAINTING NAUTICAL TILES</span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-zinc-500">
            Fetching CartoDB Dark Matter tiles & positioning fleet…
          </p>
        </div>
      )}

      {/* ── Floating Map Controls Bar ── */}
      <div className="absolute top-3 left-3 z-[400] flex flex-wrap items-center gap-2 rounded-lg border border-[#1f1f23] bg-[#0d0d0f]/90 p-1.5 backdrop-blur-md shadow-xl text-xs">
        {/* Class Filters */}
        <span className="font-mono text-[10px] text-zinc-500 uppercase px-1.5">
          CLASS:
        </span>
        {["ALL", "Capesize", "Panamax", "Supramax", "Handysize"].map((c) => (
          <button
            key={c}
            onClick={() => setClassFilter(c)}
            className={`rounded px-2 py-1 font-mono text-[11px] font-medium transition ${
              classFilter === c
                ? "bg-blue-600 text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:bg-[#1f1f23] hover:text-[#ededed]"
            }`}
          >
            {c}
          </button>
        ))}

        <span className="text-zinc-700">|</span>

        {/* Quick Zoom Views */}
        <button
          onClick={() => {
            setMapCenter([16.0, 86.5]);
            setMapZoom(5);
          }}
          className="rounded px-2 py-1 font-mono text-[11px] text-zinc-400 hover:bg-[#1f1f23] hover:text-blue-400"
        >
          Bay of Bengal
        </button>
        <button
          onClick={() => {
            setMapCenter([-21.0, 120.0]);
            setMapZoom(5);
          }}
          className="rounded px-2 py-1 font-mono text-[11px] text-zinc-400 hover:bg-[#1f1f23] hover:text-blue-400"
        >
          NW Australia
        </button>
      </div>

      {/* ── Floating Legend Overlay ── */}
      <div className="absolute bottom-14 right-3 z-[400] hidden sm:flex flex-col gap-1.5 rounded-lg border border-[#1f1f23] bg-[#0d0d0f]/90 p-2.5 backdrop-blur-md shadow-xl text-[11px] font-mono">
        <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
          BULK VESSEL CLASSES
        </span>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#c084fc]" />
          <span className="text-zinc-300">Capesize (≥260m)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" />
          <span className="text-zinc-300">Panamax / Kamsarmax</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#06b6d4]" />
          <span className="text-zinc-300">Supramax (170–215m)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
          <span className="text-zinc-300">Handysize (100–170m)</span>
        </div>
      </div>

      {/* ── Leaflet Map Container ── */}
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        className="h-full w-full"
        zoomControl={true}
      >
        <MapController center={mapCenter} zoom={mapZoom} />

        {/* CartoDB Dark Matter tiles with API key */}
        <TileLayer
          url={
            process.env.NEXT_PUBLIC_CARTO_API_KEY
              ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${process.env.NEXT_PUBLIC_CARTO_API_KEY}`
              : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=cb1_3tnn_1_a5741039008996c36a4ff345"
          }
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={18}
          eventHandlers={{
            load: () => setTilesLoaded(true),
          }}
        />

        {/* Discharge Port Markers */}
        {ports.map((port) => (
          <Marker
            key={`port-${port.id}`}
            position={[port.lat, port.lng]}
            icon={createPortIcon(port)}
            eventHandlers={{
              click: () => onSelectPort && onSelectPort(port),
            }}
          >
            <Popup>
              <div className="p-3 space-y-1.5 font-mono text-xs text-[#ededed]">
                <div className="flex items-center justify-between gap-2 border-b border-[#27272a] pb-1.5">
                  <span className="font-semibold text-blue-400 uppercase">
                    {port.name}
                  </span>
                  <span className="text-[10px] text-zinc-400">DISCHARGE</span>
                </div>
                <div>
                  <span className="text-zinc-400">Max Draft: </span>
                  <span className="font-semibold text-emerald-400">
                    {port.max_draft_m} m
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">Max LOA: </span>
                  <span>{port.max_loa_m} m</span>
                </div>
                {port.avg_turnaround_hours && (
                  <div>
                    <span className="text-zinc-400">Avg Turnaround: </span>
                    <span>{port.avg_turnaround_hours} hours</span>
                  </div>
                )}
                {/* Live Anchorage Congestion Queue */}
                <div className="border-t border-[#27272a] pt-1.5 mt-1.5 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">Expected Wait:</span>
                    <span className="font-semibold text-amber-400">
                      ~{port.avg_turnaround_hours || 72}h
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-zinc-500">Anchorage Queue:</span>
                    <span className="text-zinc-300 font-semibold">
                      {Math.max(1, Math.round((port.avg_turnaround_hours || 72) / 24))} vessels waiting
                    </span>
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Live Vessels Markers */}
        {filteredVessels.map((vessel) => {
          if (!vessel.latitude || !vessel.longitude) return null;
          const isSelected = selectedMmsi === vessel.mmsi;
          return (
            <Marker
              key={`vessel-${vessel.mmsi}`}
              position={[vessel.latitude, vessel.longitude]}
              icon={createVesselIcon(vessel, isSelected)}
              eventHandlers={{
                click: () => onSelectVessel(vessel),
              }}
            >
              <Tooltip direction="top" offset={[0, -14]} opacity={0.95}>
                <div className="font-mono text-xs text-[#ededed]">
                  <div className="font-semibold text-blue-300">
                    {vessel.name || `MMSI ${vessel.mmsi}`}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    {vessel.inferred_class || "Cargo"} •{" "}
                    {vessel.speed ? `${vessel.speed.toFixed(1)} kn` : "0 kn"}
                  </div>
                </div>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
