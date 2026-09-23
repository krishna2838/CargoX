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
import { useTheme } from "../providers/ThemeProvider";

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

import { RouteLayer, RouteData } from "./RouteLayer";

export interface LiveMapInnerProps {
  ports: PortData[];
  vessels: VesselItem[];
  selectedMmsi: number | null;
  onSelectVessel: (vessel: VesselItem) => void;
  onSelectPort?: (port: PortData) => void;
  routes?: RouteData[];
  selectedVesselClass?: string;
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
        <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));">
          <!-- Ship Hull Polygon -->
          <polygon points="12,2 18,18 12,15 6,18" fill="${color}" stroke="#1a1a2e" stroke-width="1.5" />
          ${
            isMoving
              ? `<circle cx="12" cy="11" r="1.75" fill="#ffffff" />`
              : `<rect x="10" y="10" width="4" height="4" fill="#1a1a2e" />`
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
// The port name is rendered via a Leaflet <Tooltip permanent> with per-port
// direction offsets (see PORT_TOOLTIP_LAYOUT) so the East-Coast cluster
// (Paradip / Dhamra / Haldia / Sandheads / Vizag / Gangavaram) stays legible.
function createPortIcon(): L.DivIcon {
  const html = `
    <div style="background-color: #1e1b4b; border: 1.5px solid #6366f1; border-radius: 9999px; padding: 4px; box-shadow: 0 0 10px rgba(99,102,241,0.5); display: inline-flex;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="5" r="3"></circle>
        <line x1="12" y1="22" x2="12" y2="8"></line>
        <path d="M5 12H2a10 10 0 0 0 20 0h-3"></path>
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-port-icon",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  });
}

// Per-port tooltip placement to break up the East-Coast India cluster where
// multiple ports sit within ~50 nm of each other and their labels overlap at
// most zoom levels. Direction+offset are measured from the icon anchor.
type PortTooltipLayout = { direction: "top" | "bottom" | "left" | "right"; offset: [number, number] };
const PORT_TOOLTIP_LAYOUT: Record<string, PortTooltipLayout> = {
  paradip:      { direction: "bottom", offset: [0, 4] },
  dhamra:       { direction: "top",    offset: [0, -4] },
  haldia:       { direction: "right",  offset: [8, 0] },
  sandheads:    { direction: "left",   offset: [-8, 0] },
  visakhapatnam:{ direction: "top",    offset: [0, -4] },
  gangavaram:   { direction: "bottom", offset: [0, 4] },
  gopalpur:     { direction: "right",  offset: [8, 0] },
};
const DEFAULT_PORT_TOOLTIP: PortTooltipLayout = { direction: "bottom", offset: [0, 4] };

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

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || "";
const DARK_TILE_URL = `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`;
const LIGHT_TILE_URL = `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`;
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function LiveMapInner({
  ports,
  vessels,
  selectedMmsi,
  onSelectVessel,
  onSelectPort,
  routes,
  selectedVesselClass,
}: LiveMapInnerProps) {
  const { theme } = useTheme();

  // Filter and loading state
  const [classFilter, setClassFilter] = useState<string>("ALL");
  const [mapCenter, setMapCenter] = useState<[number, number]>([15.5, 87.0]);
  const [mapZoom, setMapZoom] = useState<number>(5);
  const [tilesLoaded, setTilesLoaded] = useState(false);

  const { tileUrl, tileAttribution, isDarkCarto } = useMemo(() => {
    if (!CARTO_KEY) {
      console.warn("CARTO API key not set — falling back to OSM tiles");
      return {
        tileUrl: OSM_TILE_URL,
        tileAttribution: "© OpenStreetMap contributors",
        isDarkCarto: false,
      };
    }
    if (theme === "light") {
      return {
        tileUrl: LIGHT_TILE_URL,
        tileAttribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        isDarkCarto: false,
      };
    }
    return {
      tileUrl: DARK_TILE_URL,
      tileAttribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      isDarkCarto: true,
    };
  }, [theme]);

  // Safety fallback so skeleton never hangs if a single tile lags
  useEffect(() => {
    const timer = setTimeout(() => setTilesLoaded(true), 2000);
    return () => clearTimeout(timer);
  }, [theme]);

  const filteredVessels = useMemo(() => {
    if (classFilter === "ALL") return vessels;
    return vessels.filter((v) => v.inferred_class === classFilter);
  }, [vessels, classFilter]);

  return (
    <div className="relative h-full w-full bg-cx-bg">
      {/* ── Tile Painting Radar Skeleton Overlay ── */}
      {!tilesLoaded && (
        <div className="pointer-events-none absolute inset-0 z-[450] flex flex-col items-center justify-center bg-cx-bg transition-opacity duration-500">
          <div className="relative flex h-36 w-36 items-center justify-center">
            <div className="absolute h-36 w-36 rounded-full border border-blue-500/10 animate-ping opacity-25" />
            <div className="absolute h-24 w-24 rounded-full border border-blue-500/20 animate-pulse" />
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/40">
              <Compass className="h-6 w-6 text-blue-500 animate-spin [animation-duration:6s]" />
            </div>
          </div>
          <p className="mt-4 font-mono text-xs text-cx-text-muted">
            Fetching maritime basemap tiles & positioning fleet…
          </p>
        </div>
      )}

      {/* ── Floating Map Controls Bar ── */}
      <div className="absolute top-3 left-3 z-[400] flex flex-wrap items-center gap-2 rounded-lg border border-cx-border bg-cx-surface/95 p-1.5 backdrop-blur-md shadow-xl text-xs">
        {/* Class Filters */}
        <span className="font-mono text-[10px] text-cx-text-muted uppercase px-1.5">
          CLASS:
        </span>
        {["ALL", "Capesize", "Panamax", "Supramax", "Handysize"].map((c) => (
          <button
            key={c}
            onClick={() => setClassFilter(c)}
            className={`rounded px-2 py-1 font-mono text-[11px] font-medium transition ${
              classFilter === c
                ? "bg-blue-600 text-white font-semibold shadow-xs"
                : "text-cx-text-secondary hover:bg-cx-hover hover:text-cx-text"
            }`}
          >
            {c}
          </button>
        ))}

        <span className="text-cx-border">|</span>

        {/* Quick Zoom Views */}
        <button
          onClick={() => {
            setMapCenter([16.0, 86.5]);
            setMapZoom(5);
          }}
          className="rounded px-2 py-1 font-mono text-[11px] text-cx-text-secondary hover:bg-cx-hover hover:text-blue-500"
        >
          Bay of Bengal
        </button>
        <button
          onClick={() => {
            setMapCenter([-21.0, 120.0]);
            setMapZoom(5);
          }}
          className="rounded px-2 py-1 font-mono text-[11px] text-cx-text-secondary hover:bg-cx-hover hover:text-blue-500"
        >
          NW Australia
        </button>
      </div>

      {/* ── Floating Legend Overlay ── */}
      {/* `vessel-classes-legend` is used by globals.css to slide the legend
          left when the vessel side panel opens so the two don't collide. */}
      <div className="vessel-classes-legend absolute bottom-14 right-3 z-[400] hidden sm:flex flex-col gap-1.5 rounded-lg border border-cx-border bg-cx-surface/95 p-2.5 backdrop-blur-md shadow-xl text-[11px] font-mono transition-[right] duration-300 ease-in-out">
        <span className="text-[10px] text-cx-text-muted font-semibold uppercase tracking-wider">
          Vessel Classes
        </span>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#c084fc]" />
            <span className="text-cx-text-secondary">Capesize</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#38bdf8]" />
            <span className="text-cx-text-secondary">Kamsarmax</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#3b82f6]" />
            <span className="text-cx-text-secondary">Panamax</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#06b6d4]" />
            <span className="text-cx-text-secondary">Supramax</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#10b981]" />
            <span className="text-cx-text-secondary">Handysize</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#6366f1]" />
            <span className="text-cx-text-secondary">Discharge Port</span>
          </div>
        </div>
      </div>

      {/* ── Main Leaflet Container ── */}
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        className="h-full w-full"
        zoomControl={true}
        data-tile-type={isDarkCarto ? "carto-dark" : "other"}
      >
        <MapController center={mapCenter} zoom={mapZoom} />

        {/* Dynamic Basemap Tiles (CartoDB Dark Matter / Positron / OSM Fallback) */}
        <TileLayer
          key={`${theme}-${isDarkCarto ? "dark" : "light"}`}
          url={tileUrl}
          attribution={tileAttribution}
          className={isDarkCarto ? "carto-dark-tile" : ""}
          maxZoom={18}
          eventHandlers={{
            load: () => setTilesLoaded(true),
          }}
        />

        {/* Sea Route Visualisation & Waypoints Overlay */}
        <RouteLayer
          routes={routes || []}
          vessels={vessels}
          selectedVesselClass={selectedVesselClass}
        />

        {/* Discharge Port Markers */}
        {ports.map((port) => {
          const layout = PORT_TOOLTIP_LAYOUT[port.id] ?? DEFAULT_PORT_TOOLTIP;
          return (
          <Marker
            key={`port-${port.id}`}
            position={[port.lat, port.lng]}
            icon={createPortIcon()}
            eventHandlers={{
              click: () => onSelectPort && onSelectPort(port),
            }}
          >
            <Tooltip
              permanent
              direction={layout.direction}
              offset={layout.offset}
              className="port-label-tooltip"
              opacity={1}
            >
              {port.name} ({port.max_draft_m}m)
            </Tooltip>
            <Popup>
              <div className="p-3 space-y-1.5 font-mono text-xs text-cx-text">
                <div className="flex items-center justify-between gap-2 border-b border-cx-border-subtle pb-1.5">
                  <span className="font-semibold text-blue-500 uppercase">
                    {port.name}
                  </span>
                  <span className="text-[10px] text-cx-text-muted">DISCHARGE</span>
                </div>
                <div>
                  <span className="text-cx-text-secondary">Max Draft: </span>
                  <span className="font-semibold text-emerald-500 dark:text-emerald-400">
                    {port.max_draft_m} m
                  </span>
                </div>
                <div>
                  <span className="text-cx-text-secondary">Max LOA: </span>
                  <span>{port.max_loa_m} m</span>
                </div>
                {port.avg_turnaround_hours && (
                  <div>
                    <span className="text-cx-text-secondary">Avg Turnaround: </span>
                    <span>{port.avg_turnaround_hours} hours</span>
                  </div>
                )}
                {/* Live Anchorage Congestion Queue */}
                <div className="border-t border-cx-border-subtle pt-1.5 mt-1.5 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-cx-text-secondary">Expected Wait:</span>
                    <span className="font-semibold text-amber-500">
                      ~{port.avg_turnaround_hours || 72}h
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-cx-text-muted">Anchorage Queue:</span>
                    <span className="text-cx-text font-semibold">
                      {Math.max(1, Math.round((port.avg_turnaround_hours || 72) / 24))} vessels waiting
                    </span>
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
          );
        })}

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
                <div className="font-mono text-xs text-cx-text">
                  <div className="font-semibold text-blue-500">
                    {vessel.name || `MMSI ${vessel.mmsi}`}
                  </div>
                  <div className="text-[10px] text-cx-text-secondary">
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
