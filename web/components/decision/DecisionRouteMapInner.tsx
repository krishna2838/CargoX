"use client";

import React, { useEffect, useMemo } from "react";
import Link from "next/link";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { Compass, ExternalLink, Navigation, Ship } from "lucide-react";
import { useTheme } from "../providers/ThemeProvider";
import type { RouteData, RouteScenario } from "../map/RouteLayer";

interface DecisionRouteMapInnerProps {
  route: RouteData;
  vesselClass: string;
  loadPortId: string;
  destPortId: string;
  commodity: string;
  cargoTonnes: number;
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

const CLASS_COLORS: Record<string, string> = {
  Capesize: "#a855f7",
  Panamax: "#3b82f6",
  Kamsarmax: "#38bdf8",
  Supramax: "#06b6d4",
  Handysize: "#10b981",
  default: "#3b82f6",
};

// ── Coordinate flip utility: GeoJSON [lng, lat] → Leaflet [lat, lng] ─────
export const flipCoords = (coords: [number, number][]): [number, number][] =>
  coords.map(([lng, lat]) => [lat, lng]);

function FitRouteBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length > 0) {
      try {
        const bounds = L.latLngBounds(coords);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7, animate: false });
      } catch (err) {
        console.warn("Failed to fit mini-map route bounds", err);
      }
    }
  }, [coords, map]);
  return null;
}

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || "";
const DARK_TILE_URL = `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`;
const LIGHT_TILE_URL = `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`;
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function DecisionRouteMapInner({
  route,
  vesselClass,
  loadPortId,
  destPortId,
  commodity,
  cargoTonnes,
  exampleVessel,
}: DecisionRouteMapInnerProps) {
  const { theme } = useTheme();

  // Flip GeoJSON coordinates to Leaflet [lat, lng]
  const latLngs = useMemo(
    () => flipCoords(route.route_geometry.coordinates),
    [route.route_geometry.coordinates]
  );

  const activeScenario: RouteScenario | undefined =
    route.scenarios.find(
      (s) => s.vessel_class.toLowerCase() === vesselClass.toLowerCase()
    ) ||
    route.scenarios.find((s) => s.feasible) ||
    route.scenarios[0];

  const classColor = CLASS_COLORS[vesselClass] || CLASS_COLORS.default;

  const { tileUrl, tileAttribution, isDarkCarto } = useMemo(() => {
    if (!CARTO_KEY) {
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

  const mapCenter: [number, number] =
    latLngs.length > 0 ? latLngs[Math.floor(latLngs.length / 2)] : [0, 110];

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={mapCenter}
        zoom={4}
        className="h-full w-full rounded-xl"
        zoomControl={false}
        attributionControl={false}
        data-tile-type={isDarkCarto ? "carto-dark" : "other"}
      >
        <FitRouteBounds coords={latLngs} />

        {/* CARTO Basemap Tiles */}
        <TileLayer
          key={`${theme}-${isDarkCarto ? "dark" : "light"}`}
          url={tileUrl}
          attribution={tileAttribution}
          className={isDarkCarto ? "carto-dark-tile" : ""}
          maxZoom={18}
        />

        {/* Sea Route Polyline */}
        <Polyline
          positions={latLngs}
          pathOptions={{
            color: classColor,
            weight: 3.5,
            dashArray: "8, 8",
            opacity: 0.95,
          }}
        />

        {/* Load Port Marker (Green) */}
        <CircleMarker
          center={[route.load_port.lat, route.load_port.lng]}
          radius={6}
          pathOptions={{
            color: "#10b981",
            fillColor: "#10b981",
            fillOpacity: 1,
            weight: 2,
          }}
        >
          <Tooltip direction="top" offset={[0, -6]} permanent>
            <span className="font-mono text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 bg-cx-surface/90 px-1 py-0.5 rounded shadow">
              ⚓ {route.load_port.name}
            </span>
          </Tooltip>
        </CircleMarker>

        {/* Dest Port Marker (Red with Draft limit) */}
        <CircleMarker
          center={[route.dest_port.lat, route.dest_port.lng]}
          radius={6}
          pathOptions={{
            color: "#ef4444",
            fillColor: "#ef4444",
            fillOpacity: 1,
            weight: 2,
          }}
        >
          <Tooltip direction="top" offset={[0, -6]} permanent>
            <span className="font-mono text-[9px] font-semibold text-rose-600 dark:text-rose-400 bg-cx-surface/90 px-1 py-0.5 rounded shadow">
              📍 {route.dest_port.name} ({route.dest_port.max_draft_m || 14.5}m)
            </span>
          </Tooltip>
        </CircleMarker>

        {/* Recommended Vessel Position on Route (AIS Pulsing dot) */}
        {exampleVessel && exampleVessel.latitude && exampleVessel.longitude && (
          <Marker
            position={[exampleVessel.latitude, exampleVessel.longitude]}
            icon={L.divIcon({
              html: `
                <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
                  <div style="position: absolute; inset: 0; border-radius: 9999px; background-color: rgba(59,130,246,0.4); animation: ping 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
                  <div style="width: 12px; height: 12px; border-radius: 9999px; background-color: #3b82f6; border: 2px solid #ffffff; box-shadow: 0 0 10px rgba(59,130,246,0.9);"></div>
                </div>
              `,
              className: "mini-map-vessel-pulsing",
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            })}
          >
            <Popup>
              <div className="p-1 font-mono text-[11px] text-cx-text">
                <div className="font-bold text-blue-500">
                  {exampleVessel.name || "RECOMMENDED BULKER"}
                </div>
                <div className="text-[10px] text-cx-text-secondary mt-0.5">
                  {exampleVessel.inferred_class || vesselClass} • ETA:{" "}
                  {exampleVessel.eta || activeScenario?.eta || "Inbound"}
                </div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* ── Route Info Floating Overlay (Bottom Left) ── */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex items-center gap-1.5 rounded-lg border border-cx-border bg-cx-surface/95 px-2.5 py-1.5 backdrop-blur-md shadow-xl font-mono text-[11px]">
        <span className="font-semibold text-cx-text">
          {route.distance_nm.toLocaleString()} NM
        </span>
        <span className="text-cx-text-muted">·</span>
        <span className="text-cx-text-secondary">
          {activeScenario?.sea_days || 14.6} days
        </span>
        <span className="text-cx-text-muted">·</span>
        <span className="font-bold text-emerald-500 dark:text-emerald-400">
          ₹{activeScenario?.landed_cost_per_tonne_inr.toLocaleString() || "16,009"}/t
        </span>
      </div>

      {/* ── View Full Route on Map Link (Top Right) ── */}
      <div className="absolute top-3 right-3 z-[400]">
        <Link
          href={`/?route=${encodeURIComponent(loadPortId)},${encodeURIComponent(destPortId)},${encodeURIComponent(vesselClass)}&commodity=${encodeURIComponent(commodity)}&tonnes=${cargoTonnes}`}
          className="flex items-center gap-1 rounded-lg border border-cx-border bg-cx-surface/95 px-3 py-1.5 font-mono text-xs font-semibold text-blue-500 hover:text-blue-400 hover:bg-cx-hover backdrop-blur-md shadow-xl transition cursor-pointer"
        >
          <span>View Full Route on Map</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
