import React, { useEffect } from "react";
import { X } from "lucide-react";

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function SidePanel({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  children,
  footer,
  className = "",
}: SidePanelProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex pointer-events-none">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-200 pointer-events-auto"
      />

      {/* Panel container: Responsive bottom sheet on mobile, right slide-over on desktop */}
      <div
        className={`pointer-events-auto fixed z-50 flex flex-col bg-cx-card border-cx-border shadow-2xl transition-transform duration-300 ease-in-out
          /* Mobile: Bottom sheet */
          bottom-0 left-0 right-0 max-h-[85vh] rounded-t-2xl border-t border-x
          /* Desktop (md+): Right drawer */
          md:bottom-0 md:top-0 md:left-auto md:right-0 md:w-[420px] md:max-h-none md:rounded-none md:border-l md:border-t-0 md:border-r-0
          ${className}`}
      >
        {/* Mobile drag handle bar */}
        <div className="flex justify-center pt-2 pb-1 md:hidden">
          <div className="h-1.5 w-12 rounded-full bg-cx-border" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between border-b border-cx-border p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-cx-text">
                {title}
              </h2>
              {badge}
            </div>
            {subtitle && (
              <p className="font-mono text-xs text-cx-text-secondary">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-md p-1.5 text-cx-text-secondary transition hover:bg-cx-hover hover:text-cx-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>

        {/* Optional Footer */}
        {footer && (
          <div className="border-t border-cx-border bg-cx-surface p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
