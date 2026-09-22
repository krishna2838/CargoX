"use client";

import React from "react";
import { Sliders, Ship, MapPin, Calendar, Layers, Play } from "lucide-react";

export interface PortOption {
  id: string;
  name: string;
  country?: string;
  max_draft_m?: number;
}

export interface DecisionFormValues {
  cargo_tonnes: number;
  commodity: string;
  load_port_id: string;
  dest_port_id: string;
  laycan_start: string;
  laycan_end: string;
}

interface DecisionFormProps {
  values: DecisionFormValues;
  onChange: (values: DecisionFormValues) => void;
  onSubmit: () => void;
  loading: boolean;
  loadPorts: PortOption[];
  destPorts: PortOption[];
  selectedMmsi?: string | null;
}

export function DecisionForm({
  values,
  onChange,
  onSubmit,
  loading,
  loadPorts,
  destPorts,
  selectedMmsi,
}: DecisionFormProps) {
  const handleChange = (field: keyof DecisionFormValues, val: any) => {
    onChange({ ...values, [field]: val });
  };

  return (
    <div className="w-full rounded-xl border border-[#1f1f23] bg-[#121214] p-4 sm:p-5 shadow-lg space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1f1f23] pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-950/60 border border-blue-800/60 text-blue-400">
            <Sliders className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-[#ededed]">
              Procurement Parameters
            </h2>
            <p className="text-[11px] text-zinc-400">
              Configure parcel volume, trade lane ports, and laycan window
            </p>
          </div>
        </div>

        {selectedMmsi && (
          <div className="flex items-center gap-1.5 rounded-full bg-blue-950/40 border border-blue-800/40 px-2.5 py-0.5 font-mono text-[10px] text-blue-300">
            <Ship className="h-3 w-3" />
            <span>Telemetry prefilled for MMSI {selectedMmsi}</span>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {/* 1. Cargo Tonnes */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <span>Parcel Volume (MT)</span>
            </label>
            <div className="relative">
              <input
                type="number"
                min="10000"
                max="350000"
                step="5000"
                value={values.cargo_tonnes}
                onChange={(e) => handleChange("cargo_tonnes", Number(e.target.value))}
                className="w-full rounded-lg border border-[#27272a] bg-[#161619] px-3 py-2 font-mono text-xs text-[#ededed] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
                required
              />
              <span className="pointer-events-none absolute right-3 top-2 font-mono text-xs text-zinc-400">
                tonnes
              </span>
            </div>
          </div>

          {/* 2. Commodity */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <span>Bulk Commodity</span>
            </label>
            <select
              value={values.commodity}
              onChange={(e) => handleChange("commodity", e.target.value)}
              className="w-full rounded-lg border border-[#27272a] bg-[#161619] px-3 py-2 font-mono text-xs text-[#ededed] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
            >
              <option value="coking_coal">Coking Coal (Met Coal FOB)</option>
              <option value="iron_ore">Iron Ore (62% Fe CFR/FOB)</option>
              <option value="thermal_coal">Thermal Coal (Steam Coal)</option>
            </select>
          </div>

          {/* 3. Load Port */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <MapPin className="h-3.5 w-3.5 text-blue-400" />
              <span>Loading Port (Export)</span>
            </label>
            <select
              value={values.load_port_id}
              onChange={(e) => handleChange("load_port_id", e.target.value)}
              className="w-full rounded-lg border border-[#27272a] bg-[#161619] px-3 py-2 font-mono text-xs text-[#ededed] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
            >
              {loadPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.country ? `(${p.country})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Destination Port */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <MapPin className="h-3.5 w-3.5 text-emerald-400" />
              <span>Discharge Port (India East Coast)</span>
            </label>
            <select
              value={values.dest_port_id}
              onChange={(e) => handleChange("dest_port_id", e.target.value)}
              className="w-full rounded-lg border border-[#27272a] bg-[#161619] px-3 py-2 font-mono text-xs text-[#ededed] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
            >
              {destPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.max_draft_m ? `(${p.max_draft_m}m draft)` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Laycan Start */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <Calendar className="h-3.5 w-3.5 text-zinc-400" />
              <span>Laycan Window Start</span>
            </label>
            <input
              type="date"
              value={values.laycan_start}
              onChange={(e) => handleChange("laycan_start", e.target.value)}
              className="w-full rounded-lg border border-[#27272a] bg-[#161619] px-3 py-2 font-mono text-xs text-[#ededed] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              required
            />
          </div>

          {/* 6. Laycan End */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <Calendar className="h-3.5 w-3.5 text-zinc-400" />
              <span>Laycan Window End</span>
            </label>
            <input
              type="date"
              value={values.laycan_end}
              onChange={(e) => handleChange("laycan_end", e.target.value)}
              className="w-full rounded-lg border border-[#27272a] bg-[#161619] px-3 py-2 font-mono text-xs text-[#ededed] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              required
            />
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-end pt-1">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 font-mono text-xs font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 active:scale-[0.99] disabled:opacity-50 transition cursor-pointer"
          >
            {loading ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Simulating Scenarios…</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Analyse Procurement Options</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
