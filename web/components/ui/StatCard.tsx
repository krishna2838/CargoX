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
  sparklineColor = "var(--cx-accent)",
  badge,
  className = "",
}: StatCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-cx-border bg-cx-card p-4 transition-all duration-150 hover:border-cx-border-subtle hover:bg-cx-hover ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-cx-text-secondary">
          {title}
        </span>
        <div className="flex items-center gap-1.5">
          {badge}
          {icon && <span className="text-cx-text-muted">{icon}</span>}
        </div>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-semibold tracking-tight text-cx-text">
            {value}
          </span>
          {unit && (
            <span className="font-mono text-xs text-cx-text-muted">{unit}</span>
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
                  ? "text-emerald-500 dark:text-emerald-400"
                  : delta.isPositive === false
                    ? "text-rose-500 dark:text-rose-400"
                    : "text-cx-text-secondary"
              }`}
            >
              <span>{delta.isPositive ? "▲" : delta.isPositive === false ? "▼" : "•"}</span>
              <span>{delta.value}</span>
              {delta.label && (
                <span className="ml-1 text-cx-text-muted">{delta.label}</span>
              )}
            </span>
          )}
          {subValue && <span className="text-cx-text-secondary truncate">{subValue}</span>}
        </div>
      )}
    </div>
  );
}
