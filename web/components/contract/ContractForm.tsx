"use client";

import React from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";

export interface PortOption {
  id: string;
  name: string;
}

export interface ContractFormValues {
  annual_tonnes: number;
  parcel_size: number;
  commodity: "coking_coal" | "thermal_coal" | "iron_ore";
  load_port_id: string;
  dest_port_id: string;
  contract_months: 3 | 6 | 12;
  start_date: string; // YYYY-MM-DD
}

interface ContractFormProps {
  values: ContractFormValues;
  onChange: (values: ContractFormValues) => void;
  onSubmit: () => void;
  onReset: () => void;
  loadPorts: PortOption[];
  destPorts: PortOption[];
  loading: boolean;
  disabled?: boolean;
}

const COMMODITY_OPTIONS: { value: ContractFormValues["commodity"]; label: string }[] = [
  { value: "coking_coal",  label: "Coking Coal (Premium AU FOB)" },
  { value: "thermal_coal", label: "Thermal Coal (SA FOB)" },
  { value: "iron_ore",     label: "Iron Ore (62% Fe CFR)" },
];

const CONTRACT_MONTHS: ContractFormValues["contract_months"][] = [3, 6, 12];

export function ContractForm({
  values,
  onChange,
  onSubmit,
  onReset,
  loadPorts,
  destPorts,
  loading,
  disabled = false,
}: ContractFormProps) {
  const patch = <K extends keyof ContractFormValues>(key: K, v: ContractFormValues[K]) =>
    onChange({ ...values, [key]: v });

  const totalContractTonnes = Math.round(values.annual_tonnes * (values.contract_months / 12));
  const impliedVoyages = values.parcel_size > 0
    ? Math.ceil(totalContractTonnes / values.parcel_size)
    : 0;

  const parcelTooBig = values.parcel_size > totalContractTonnes && values.parcel_size > 0;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!loading && !disabled && !parcelTooBig) onSubmit(); }}
      className="flex flex-col gap-4 rounded-xl border border-cx-border bg-cx-card p-4 font-mono text-xs"
    >
      <div className="flex items-center justify-between border-b border-cx-border pb-3">
        <div>
          <h2 className="text-sm font-semibold text-cx-text">Contract Parameters</h2>
          <p className="text-[11px] text-cx-text-muted mt-0.5">
            Multi-voyage schedule, evenly spaced across the contract window.
          </p>
        </div>
      </div>

      {/* Volume */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-cx-text-muted uppercase font-semibold">
            Annual Volume (t)
          </span>
          <input
            type="number"
            min={1}
            step={10000}
            value={values.annual_tonnes}
            onChange={(e) => patch("annual_tonnes", Math.max(0, Number(e.target.value) || 0))}
            className="rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-cx-text-muted uppercase font-semibold">
            Parcel Size (t)
          </span>
          <input
            type="number"
            min={1}
            step={5000}
            value={values.parcel_size}
            onChange={(e) => patch("parcel_size", Math.max(0, Number(e.target.value) || 0))}
            className="rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
          />
        </label>
      </div>

      {/* Commodity */}
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-cx-text-muted uppercase font-semibold">Commodity</span>
        <select
          value={values.commodity}
          onChange={(e) => patch("commodity", e.target.value as ContractFormValues["commodity"])}
          className="rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
        >
          {COMMODITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {/* Ports */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-cx-text-muted uppercase font-semibold">Load Port</span>
          <select
            value={values.load_port_id}
            onChange={(e) => patch("load_port_id", e.target.value)}
            className="rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
          >
            {loadPorts.length === 0 && <option value="">Loading…</option>}
            {loadPorts.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-cx-text-muted uppercase font-semibold">Destination</span>
          <select
            value={values.dest_port_id}
            onChange={(e) => patch("dest_port_id", e.target.value)}
            className="rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
          >
            {destPorts.length === 0 && <option value="">Loading…</option>}
            {destPorts.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Contract duration radio */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-cx-text-muted uppercase font-semibold">
          Contract Duration
        </span>
        <div className="grid grid-cols-3 gap-2">
          {CONTRACT_MONTHS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => patch("contract_months", m)}
              className={`rounded border px-2 py-1.5 text-xs font-semibold transition ${
                values.contract_months === m
                  ? "border-blue-500 bg-blue-500/10 text-blue-500"
                  : "border-cx-border bg-cx-bg text-cx-text-secondary hover:bg-cx-hover"
              }`}
            >
              {m} months
            </button>
          ))}
        </div>
      </div>

      {/* Start date */}
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-cx-text-muted uppercase font-semibold">Start Date</span>
        <input
          type="date"
          value={values.start_date}
          onChange={(e) => patch("start_date", e.target.value)}
          className="rounded border border-cx-border bg-cx-bg px-2.5 py-1.5 font-mono text-xs text-cx-text focus:border-blue-500 focus:outline-hidden"
        />
      </label>

      {/* Live implied summary */}
      <div className="rounded bg-cx-bg border border-cx-border-subtle p-2.5 text-[11px] text-cx-text-secondary">
        <div className="flex justify-between">
          <span>Total contract volume:</span>
          <span className="font-semibold text-cx-text">
            {totalContractTonnes.toLocaleString()} t
          </span>
        </div>
        <div className="flex justify-between mt-1">
          <span>Implied voyages:</span>
          <span className="font-semibold text-cx-text">{impliedVoyages}</span>
        </div>
        {parcelTooBig && (
          <p className="mt-2 text-rose-500 text-[11px]">
            Parcel is larger than the whole contract volume — nothing to schedule.
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={loading || disabled || parcelTooBig}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-mono text-xs font-semibold text-white transition hover:bg-blue-500 shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Planning…</>
            : <><Play className="h-3.5 w-3.5 fill-current" /> Plan Contract</>
          }
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={loading}
          className="rounded-lg border border-cx-border px-3 py-2 text-xs font-medium text-cx-text-secondary hover:bg-cx-hover transition disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </form>
  );
}
