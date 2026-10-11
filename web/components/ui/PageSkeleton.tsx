import React from "react";

interface PageSkeletonProps {
  /**
   * "page"  — title + subtitle + a 3-up card row (default, for a whole view)
   * "stats" — just a responsive card row, for swapping in place of an
   *           existing stat grid while its data is in flight
   */
  variant?: "page" | "stats";
  /** How many placeholder cards to draw in the row. */
  cards?: number;
  className?: string;
}

/**
 * Shared loading placeholder.
 *
 * Uses the `.skeleton` utility from globals.css (theme-token background +
 * soft pulse) rather than hardcoded white/black alphas, so it stays visible
 * in both light and dark themes.
 */
export function PageSkeleton({
  variant = "page",
  cards = 3,
  className = "",
}: PageSkeletonProps) {
  const cardRow = (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-[108px] rounded-xl"
          /* Stagger the pulse so the row shimmers rather than strobing. */
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );

  if (variant === "stats") {
    return (
      <div className={className} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading latest figures…</span>
        {cardRow}
      </div>
    );
  }

  return (
    <div
      className={`space-y-4 ${className}`}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      <div className="skeleton h-8 w-1/3" />
      <div className="skeleton h-4 w-2/3" style={{ animationDelay: "90ms" }} />
      {cardRow}
    </div>
  );
}
