import React from "react";
import { Sparkline } from "./Sparkline";

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  subValue?: string;
  delta?: {
    value: string | number;
    isPositive?: boolean;
    label?: string;
  };
  icon?: React.ReactNode;
  sparklineData?: number[];
  sparklineColor?: string;
  badge?: React.ReactNode;
  className?: string;
}

export function StatCard({
  title,
  value,
  unit,
  subValue,
  delta,
  icon,
  sparklineData,
  sparklineColor = "#3b82f6",
  badge,
  className = "",
}: StatCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-[#1f1f23] bg-[#121214] p-4 transition-all duration-150 hover:border-[#27272a] hover:bg-[#151518] ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          {title}
        </span>
        <div className="flex items-center gap-1.5">
          {badge}
          {icon && <span className="text-zinc-500">{icon}</span>}
        </div>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-semibold tracking-tight text-[#ededed]">
            {value}
          </span>
          {unit && (
            <span className="font-mono text-xs text-zinc-400">{unit}</span>
          )}
        </div>

        {sparklineData && sparklineData.length > 1 && (
          <div className="shrink-0">
            <Sparkline
              data={sparklineData}
              width={75}
              height={22}
              color={sparklineColor}
            />
          </div>
        )}
      </div>

      {(subValue || delta) && (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          {delta && (
            <span
              className={`inline-flex items-center gap-0.5 font-mono font-medium ${
                delta.isPositive === true
                  ? "text-emerald-400"
                  : delta.isPositive === false
                    ? "text-rose-400"
                    : "text-zinc-400"
              }`}
            >
              <span>{delta.isPositive ? "▲" : delta.isPositive === false ? "▼" : "•"}</span>
              <span>{delta.value}</span>
              {delta.label && (
                <span className="ml-1 text-zinc-500">{delta.label}</span>
              )}
            </span>
          )}
          {subValue && <span className="text-zinc-400 truncate">{subValue}</span>}
        </div>
      )}
    </div>
  );
}
