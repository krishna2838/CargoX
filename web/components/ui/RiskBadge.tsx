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

  let colorClasses = "bg-emerald-950/40 text-emerald-400 border-emerald-800/60";
  let dotColor = "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]";
  let label = "LOW RISK";

  if (normBand === "high") {
    colorClasses = "bg-rose-950/40 text-rose-400 border-rose-800/60";
    dotColor = "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.6)]";
    label = "HIGH RISK";
  } else if (normBand === "medium" || normBand === "med") {
    colorClasses = "bg-amber-950/40 text-amber-400 border-amber-800/60";
    dotColor = "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]";
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
