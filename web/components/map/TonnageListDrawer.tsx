"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronUp, ChevronDown, Ship, Sliders, Info } from "lucide-react";
import { DataTable, Column } from "../ui/DataTable";

export interface OpenVessel {
  mmsi: number;
  name: string;
  inferred_class: string;
  dwt_capacity?: number;
  draft?: number;
  destination: string;
  eta: string;
  is_seeded?: boolean;
}

interface TonnageListDrawerProps {
  vessels: OpenVessel[];
  onSelectVessel?: (mmsi: number) => void;
  className?: string;
}

export function TonnageListDrawer({
  vessels,
  onSelectVessel,
  className = "",
}: TonnageListDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const columns: Column<OpenVessel>[] = [
    {
      key: "name",
      header: "VESSEL",
      accessor: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#ededed]">{row.name}</span>
          {row.is_seeded && (
            <span
              title="Demonstration record: live inbound destination reports currently thin"
              className="inline-flex items-center rounded border border-zinc-700 bg-zinc-800/80 px-1 py-0.2 text-[9px] font-mono text-zinc-400 cursor-help"
            >
              SEEDED
            </span>
          )}
        </div>
      ),
    },
    {
      key: "inferred_class",
      header: "CLASS",
      accessor: (row) => (
        <span className="rounded bg-blue-950/40 border border-blue-900/40 px-1.5 py-0.5 font-mono text-[10px] text-blue-400 font-semibold">
          {row.inferred_class}
        </span>
      ),
    },
    {
      key: "dwt_capacity",
      header: "CAPACITY",
      align: "right",
      accessor: (row) => (
        <span className="text-zinc-300">
          {row.dwt_capacity ? `${(row.dwt_capacity / 1000).toFixed(0)}k DWT` : "--"}
        </span>
      ),
    },
    {
      key: "draft",
      header: "DRAFT",
      align: "right",
      accessor: (row) => (
        <span className="text-zinc-300">
          {row.draft ? `${Number(row.draft).toFixed(1)}m` : "--"}
        </span>
      ),
    },
    {
      key: "destination",
      header: "DESTINATION",
      accessor: (row) => (
        <span className="text-emerald-400 font-semibold uppercase">
          {row.destination}
        </span>
      ),
    },
    {
      key: "eta",
      header: "ETA INDIA",
      accessor: (row) => (
        <span className="text-zinc-400 font-mono text-[11px]">{row.eta}</span>
      ),
    },
    {
      key: "action",
      header: "ACTION",
      align: "right",
      accessor: (row) => {
        const queryParams = new URLSearchParams({
          klass: row.inferred_class || "Panamax",
          dest: row.destination.toLowerCase().includes("paradip")
            ? "paradip"
            : row.destination.toLowerCase().includes("vizag") ||
                row.destination.toLowerCase().includes("visakhapatnam")
              ? "visakhapatnam"
              : "paradip",
          mmsi: String(row.mmsi),
        });
        return (
          <Link
            href={`/decision?${queryParams.toString()}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded bg-blue-600/20 border border-blue-500/40 px-2 py-1 font-mono text-[10px] font-medium text-blue-300 hover:bg-blue-600 hover:text-white transition"
          >
            <Sliders className="h-3 w-3" />
            <span>Use vessel</span>
          </Link>
        );
      },
    },
  ];

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-300 ease-in-out ${
        isOpen ? "translate-y-0" : "translate-y-[calc(100%-42px)]"
      } ${className}`}
    >
      <div className="mx-auto max-w-6xl px-0 sm:px-4">
        <div className="rounded-none sm:rounded-t-xl border-t sm:border-x border-[#1f1f23] bg-[#0f0f12]/95 backdrop-blur-md shadow-2xl">
          {/* Header Bar / Toggle Handle */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left transition hover:bg-[#161619]"
          >
            <div className="flex items-center gap-2.5">
              <Ship className="h-4 w-4 text-blue-400" />
              <span className="font-mono text-xs font-semibold tracking-wider text-[#ededed]">
                TONNAGE LIST
              </span>
              <span className="rounded-full bg-blue-950/60 border border-blue-800/60 px-2 py-0.2 font-mono text-[10px] text-blue-400">
                {vessels.length} inbound ships
              </span>
              <span className="hidden sm:inline-block text-zinc-500 text-xs font-mono">
                Heading towards Indian East Coast discharge ports
              </span>
            </div>

            <div className="flex items-center gap-1 text-zinc-400 font-mono text-xs">
              <span>{isOpen ? "COLLAPSE" : "EXPAND"}</span>
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </div>
          </button>

          {/* Table Container */}
          {isOpen && (
            <div className="max-h-72 overflow-y-auto p-3 border-t border-[#1f1f23]">
              <DataTable
                columns={columns}
                data={vessels}
                keyExtractor={(row) => row.mmsi}
                onRowClick={(row) => onSelectVessel && onSelectVessel(row.mmsi)}
                emptyMessage="No open bulk vessels currently reporting destination to East Coast India."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
