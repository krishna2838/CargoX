"use client";

import React, { useEffect, useState } from "react";
import { Flame, Droplets, Gem, DollarSign } from "lucide-react";

interface CommoditiesData {
  date?: string;
  iron_ore_usd_dmt?: number;
  coal_au_usd_mt?: number;
  coal_sa_usd_mt?: number;
  crude_avg_usd_bbl?: number;
}

interface FxData {
  date?: string;
  usd_inr?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export function CommoditiesStrip() {
  const [commodities, setCommodities] = useState<CommoditiesData | null>(null);
  const [fx, setFx] = useState<FxData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [cRes, fxRes] = await Promise.all([
          fetch(`${API_BASE}/commodities/latest`),
          fetch(`${API_BASE}/fx`),
        ]);

        if (cRes.ok && !cancelled) {
          const cData = await cRes.json();
          setCommodities(cData);
        }
        if (fxRes.ok && !cancelled) {
          const fxData = await fxRes.json();
          setFx(fxData);
        }
      } catch (err) {
        console.error("Failed to load commodities or FX", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    const interval = setInterval(loadData, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const items = [
    {
      id: "iron_ore",
      label: "IRON ORE 62% FE",
      sub: "CFR China Benchmark",
      value: commodities?.iron_ore_usd_dmt
        ? `$${commodities.iron_ore_usd_dmt.toFixed(2)}`
        : "--",
      unit: "/ dmt",
      icon: Gem,
      iconColor: "text-amber-500",
    },
    {
      id: "coal_au",
      label: "COKING COAL (AU)",
      sub: "Premium Low-Vol FOB",
      value: commodities?.coal_au_usd_mt
        ? `$${commodities.coal_au_usd_mt.toFixed(2)}`
        : "--",
      unit: "/ mt",
      icon: Flame,
      iconColor: "text-orange-500",
    },
    {
      id: "coal_sa",
      label: "THERMAL COAL (SA)",
      sub: "Richards Bay 6000 kcal",
      value: commodities?.coal_sa_usd_mt
        ? `$${commodities.coal_sa_usd_mt.toFixed(2)}`
        : "--",
      unit: "/ mt",
      icon: Flame,
      iconColor: "text-rose-500",
    },
    {
      id: "crude",
      label: "CRUDE OIL AVG",
      sub: "Brent / WTI Composite",
      value: commodities?.crude_avg_usd_bbl
        ? `$${commodities.crude_avg_usd_bbl.toFixed(2)}`
        : "--",
      unit: "/ bbl",
      icon: Droplets,
      iconColor: "text-cyan-500",
    },
    {
      id: "usdinr",
      label: "USD / INR FX",
      sub: "ECB / RBI Reference",
      value: fx?.usd_inr ? `₹${fx.usd_inr.toFixed(2)}` : "--",
      unit: "/ USD",
      icon: DollarSign,
      iconColor: "text-emerald-500",
    },
  ];

  return (
    <div className="w-full rounded-xl border border-cx-border bg-cx-card p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          <span className="font-mono text-[10px] font-semibold tracking-wider text-cx-text-secondary uppercase">
            GLOBAL COMMODITIES &amp; FX BENCHMARKS
          </span>
        </div>
        <span className="font-mono text-[10px] text-cx-text-muted">
          World Bank Pink Sheet &middot; Daily Forward-Fill
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="flex flex-col justify-between rounded-lg border border-cx-border bg-cx-surface p-2.5 transition hover:border-cx-border-subtle hover:bg-cx-hover"
            >
              <div className="flex items-center justify-between text-cx-text-secondary">
                <span className="font-mono text-[10px] font-medium tracking-tight text-cx-text-secondary">
                  {item.label}
                </span>
                <Icon className={`h-3.5 w-3.5 ${item.iconColor}`} />
              </div>

              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-mono text-base font-semibold text-cx-text">
                  {item.value}
                </span>
                <span className="font-mono text-[10px] text-cx-text-muted">
                  {item.unit}
                </span>
              </div>

              <div className="mt-0.5 text-[9px] text-cx-text-muted truncate">
                {item.sub}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
