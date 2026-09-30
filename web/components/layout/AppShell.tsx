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
  Sun,
  Moon,
  FileSignature,
} from "lucide-react";
import { useTheme } from "../providers/ThemeProvider";

interface AppShellProps {
  children: React.ReactNode;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
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
      href: "/contract",
      label: "Contract",
      icon: FileSignature,
      description: "Multi-voyage contract planner",
    },
    {
      href: "/what-if",
      label: "What-If",
      icon: Layers,
      description: "Sensitivity & scenario analysis",
    },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-cx-bg text-cx-text">
      {/* ── Desktop Left Sidebar (expanded 224px, labels visible on md+) ── */}
      {/* Mobile intentionally has no sidebar — the bottom nav below serves     */}
      {/* that role. Icon sizing is unchanged; only the row layout and         */}
      {/* container width grew so labels can sit alongside each icon.          */}
      <aside className="hidden md:flex flex-col justify-between border-r border-cx-border bg-cx-surface py-4 w-56 shrink-0 z-30 transition-colors duration-150">
        <div className="flex flex-col gap-6">
          {/* Logo Mark + Wordmark */}
          <Link
            href="/"
            className="flex items-center gap-2.5 px-4 group"
            title="CargoX"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/10 border border-blue-500/30 text-blue-500 transition group-hover:bg-blue-600/20 shrink-0">
              <Ship className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-cx-text truncate">
              CargoX
            </span>
          </Link>

          {/* Navigation rows (icon + label) */}
          <nav className="flex flex-col gap-1 px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={`${item.label} — ${item.description}`}
                  className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-blue-500/15 text-blue-500"
                      : "text-cx-text-secondary hover:bg-cx-hover hover:text-cx-text"
                  }`}
                >
                  {/* Active left-edge indicator (task spec: border-l-2 blue) */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-r-full bg-blue-500"
                    />
                  )}
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Live AIS Beacon (icon + label now that we have room) */}
        <div
          className="flex items-center gap-2.5 px-4"
          title={fleetSource === "seeded" ? "Seeded fleet active (DEMO_MODE=true)" : "AISStream WebSocket live ingestion"}
        >
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-500 shrink-0">
            <Radio className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${fleetSource === "seeded" ? "bg-amber-400" : "bg-emerald-400"}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${fleetSource === "seeded" ? "bg-amber-500" : "bg-emerald-500"}`} />
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-cx-text-muted">
              Fleet
            </div>
            <div className="text-xs font-medium text-cx-text-secondary truncate">
              {fleetSource === "seeded" ? "Seeded" : "AIS Live"}
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main App Column ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-cx-border bg-cx-surface px-4 md:px-6 z-20 transition-colors duration-150">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-1.5">
              <span className="text-lg font-bold tracking-tight text-cx-text">
                Cargo<span className="text-blue-500">X</span>
              </span>
              <span className="hidden sm:inline-block rounded bg-cx-hover border border-cx-border px-1.5 py-0.5 font-mono text-[10px] text-cx-text-muted tracking-wider">
                TERMINAL v0.1
              </span>
            </Link>

            <span className="hidden lg:inline-block text-cx-border-subtle">|</span>
            <span className="hidden lg:inline-block text-xs text-cx-text-secondary">
              Procurement decisions for Indian bulk importers
            </span>
          </div>

          {/* Market & System Telemetry Tickers + Theme Toggle */}
          <div className="flex items-center gap-3 md:gap-4">
            {/* BDI Metric */}
            {bdiQuote && (
              <div className="hidden sm:flex items-center gap-1.5 font-mono text-xs">
                <span className="text-cx-text-muted">BDI:</span>
                <span className="font-semibold text-blue-500">
                  {bdiQuote.bdi.toLocaleString()}
                </span>
              </div>
            )}

            {/* Live Vessels Tracked */}
            <div className="flex items-center gap-1.5 font-mono text-xs text-cx-text-secondary">
              <span className="text-cx-text-muted">FLEET:</span>
              <span className="text-cx-text font-medium">
                {vesselCount !== null ? vesselCount : "..."}
              </span>
              <span className="hidden sm:inline text-cx-text-muted text-[11px]">
                ships
              </span>
              {fleetSource === "seeded" && (
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-500 tracking-wider">
                  seeded
                </span>
              )}
            </div>

            {/* API Status Indicator */}
            <div className="flex items-center gap-1.5 rounded-full border border-cx-border bg-cx-hover px-2.5 py-1 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  apiOnline === null
                    ? "bg-zinc-400 animate-pulse"
                    : apiOnline
                      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                      : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]"
                }`}
              />
              <span className="font-mono text-[11px] text-cx-text-secondary">
                {apiOnline === null
                  ? "SYNC"
                  : apiOnline
                    ? "API ONLINE"
                    : "API OFFLINE"}
              </span>
            </div>

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-cx-border bg-cx-surface text-cx-text-secondary hover:bg-cx-hover hover:text-cx-text transition-colors"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400 transition-transform hover:rotate-45" />
              ) : (
                <Moon className="h-4 w-4 text-cx-text-secondary transition-transform hover:-rotate-12" />
              )}
            </button>
          </div>
        </header>

        {/* Viewport Content */}
        <main className="relative flex-1 overflow-hidden bg-cx-bg">{children}</main>

        {/* ── Mobile Bottom Navigation Bar (below 768px) ── */}
        <nav className="flex md:hidden h-14 items-center justify-around border-t border-cx-border bg-cx-surface px-2 z-40">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center py-1 px-3 text-[10px] font-medium transition ${
                  isActive ? "text-blue-500" : "text-cx-text-secondary hover:text-cx-text"
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
