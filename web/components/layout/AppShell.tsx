"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  TrendingUp,
  Sliders,
  Layers,
  Ship,
  Radio,
  ExternalLink,
} from "lucide-react";

interface AppShellProps {
  children: React.ReactNode;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [vesselCount, setVesselCount] = useState<number | null>(null);
  const [fleetSource, setFleetSource] = useState<"live" | "seeded" | "empty" | null>(null);
  const [bdiQuote, setBdiQuote] = useState<{ bdi: number; date: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkHealthAndMarket() {
      try {
        const hRes = await fetch(`${API_BASE}/health`);
        const hData = await hRes.json();
        if (!cancelled) setApiOnline(hData.status === "ok");

        // Fetch fleet status & count
        const sRes = await fetch(`${API_BASE}/fleet/status`);
        if (sRes.ok) {
          const sData = await sRes.json();
          if (!cancelled) {
            setFleetSource(sData.fleet_source);
            setVesselCount(sData.display_count ?? sData.live_vessel_count ?? sData.seeded_vessel_count);
          }
        } else {
          // Fallback to /vessels/live
          const vRes = await fetch(`${API_BASE}/vessels/live`);
          if (vRes.ok) {
            const vData = await vRes.json();
            if (!cancelled) setVesselCount(vData.count ?? vData.vessels?.length ?? 0);
          }
        }

        // Fetch freight quote
        const fRes = await fetch(`${API_BASE}/freight/latest`);
        if (fRes.ok) {
          const fData = await fRes.json();
          if (!cancelled && fData.BDI) {
            setBdiQuote({ bdi: fData.BDI, date: fData.date });
          }
        }
      } catch {
        if (!cancelled) {
          setApiOnline(false);
        }
      }
    }

    checkHealthAndMarket();
    const interval = setInterval(checkHealthAndMarket, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const navItems = [
    {
      href: "/",
      label: "Live Map",
      icon: Compass,
      description: "Fleet tracking & East Coast ports",
    },
    {
      href: "/freight",
      label: "Freight",
      icon: TrendingUp,
      description: "Baltic indices & LightGBM forecast",
    },
    {
      href: "/decision",
      label: "Decision",
      icon: Sliders,
      description: "Procurement & charter engine",
    },
    {
      href: "/what-if",
      label: "What-If",
      icon: Layers,
      description: "Sensitivity & scenario analysis",
    },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0a0a0a] text-[#ededed]">
      {/* ── Desktop Left Sidebar (64px icon rail) ── */}
      <aside className="hidden md:flex flex-col items-center justify-between border-r border-[#1f1f23] bg-[#0d0d0f] py-4 w-16 shrink-0 z-30">
        <div className="flex flex-col items-center gap-6">
          {/* Logo Mark */}
          <Link
            href="/"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600/10 border border-blue-500/30 text-blue-400 transition hover:bg-blue-600/20"
            title="CargoX"
          >
            <Ship className="h-5 w-5" />
          </Link>

          {/* Navigation icons */}
          <nav className="flex flex-col items-center gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={`${item.label} — ${item.description}`}
                  className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-150 ${
                    isActive
                      ? "bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.25)]"
                      : "text-zinc-400 hover:bg-[#18181b] hover:text-[#ededed]"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {/* Active indicator bar */}
                  {isActive && (
                    <span className="absolute -left-2 h-5 w-1 rounded-r-full bg-blue-500" />
                  )}
                  {/* Tooltip */}
                  <span className="pointer-events-none absolute left-14 z-50 whitespace-nowrap rounded bg-[#18181b] border border-[#27272a] px-2.5 py-1 text-xs font-medium text-[#ededed] shadow-lg opacity-0 transition-opacity group-hover:opacity-100">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Live AIS Beacon */}
        <div
          className="flex flex-col items-center gap-1.5"
          title={fleetSource === "seeded" ? "Seeded fleet active (DEMO_MODE=true)" : "AISStream WebSocket live ingestion"}
        >
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-blue-950/40 border border-blue-900/40 text-blue-400">
            <Radio className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${fleetSource === "seeded" ? "bg-amber-400" : "bg-emerald-400"}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${fleetSource === "seeded" ? "bg-amber-500" : "bg-emerald-500"}`} />
            </span>
          </div>
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-tighter">
            {fleetSource === "seeded" ? "SEEDED" : "AIS LIVE"}
          </span>
        </div>
      </aside>

      {/* ── Main App Column ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1f1f23] bg-[#0f0f12] px-4 md:px-6 z-20">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-1.5">
              <span className="text-lg font-bold tracking-tight text-[#ededed]">
                Cargo<span className="text-blue-500">X</span>
              </span>
              <span className="hidden sm:inline-block rounded bg-[#1f1f23] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 tracking-wider">
                TERMINAL v0.1
              </span>
            </Link>

            <span className="hidden lg:inline-block text-zinc-600">|</span>
            <span className="hidden lg:inline-block text-xs text-zinc-400">
              Procurement decisions for Indian bulk importers
            </span>
          </div>

          {/* Market & System Telemetry Tickers */}
          <div className="flex items-center gap-3 md:gap-5">
            {/* BDI Metric */}
            {bdiQuote && (
              <div className="hidden sm:flex items-center gap-1.5 font-mono text-xs">
                <span className="text-zinc-500">BDI:</span>
                <span className="font-semibold text-blue-400">
                  {bdiQuote.bdi.toLocaleString()}
                </span>
              </div>
            )}

            {/* Live Vessels Tracked */}
            <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-300">
              <span className="text-zinc-500">FLEET:</span>
              <span className="text-[#ededed]">
                {vesselCount !== null ? vesselCount : "..."}
              </span>
              <span className="hidden sm:inline text-zinc-500 text-[11px]">
                ships
              </span>
              {fleetSource === "seeded" && (
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-400 tracking-wider">
                  seeded
                </span>
              )}
            </div>

            {/* API Status Indicator */}
            <div className="flex items-center gap-1.5 rounded-full border border-[#1f1f23] bg-[#141416] px-2.5 py-1 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  apiOnline === null
                    ? "bg-zinc-500 animate-pulse"
                    : apiOnline
                      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                      : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]"
                }`}
              />
              <span className="font-mono text-[11px] text-zinc-400">
                {apiOnline === null
                  ? "SYNC"
                  : apiOnline
                    ? "API ONLINE"
                    : "API OFFLINE"}
              </span>
            </div>
          </div>
        </header>

        {/* Viewport Content */}
        <main className="relative flex-1 overflow-hidden">{children}</main>

        {/* ── Mobile Bottom Navigation Bar (below 768px) ── */}
        <nav className="flex md:hidden h-14 items-center justify-around border-t border-[#1f1f23] bg-[#0d0d0f] px-2 z-40">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center py-1 px-3 text-[10px] font-medium transition ${
                  isActive ? "text-blue-400" : "text-zinc-400 hover:text-[#ededed]"
                }`}
              >
                <Icon className="h-5 w-5 mb-0.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
