import React from "react";

interface RiskBadgeProps {
  band: "low" | "medium" | "high" | string;
  score?: number;
  size?: "sm" | "md";
  className?: string;
}

export function RiskBadge({
  band,
  score,
  size = "md",
  className = "",
}: RiskBadgeProps) {
  const normBand = (band || "low").toLowerCase();

  let colorClasses = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
  let dotColor = "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]";
  let label = "LOW RISK";

  if (normBand === "high") {
    colorClasses = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30";
    dotColor = "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]";
    label = "HIGH RISK";
  } else if (normBand === "medium" || normBand === "med") {
    colorClasses = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
    dotColor = "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]";
    label = "MED RISK";
  }

  const sizeClasses =
    size === "sm"
      ? "px-2 py-0.5 text-[10px] tracking-wider"
      : "px-2.5 py-1 text-xs tracking-wide";

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono uppercase font-medium rounded-full border ${sizeClasses} ${colorClasses} ${className}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{label}</span>
      {score !== undefined && (
        <span className="opacity-75 text-[0.9em]">({score})</span>
      )}
    </span>
  );
}
