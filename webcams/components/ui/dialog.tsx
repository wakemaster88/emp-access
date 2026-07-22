"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeMap = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  size = "md",
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative flex w-full max-h-[calc(100vh-2rem)] flex-col rounded-2xl bg-tile ring-1 ring-border shadow-xl shadow-black/40",
          sizeMap[size],
          className,
        )}
      >
        {(title || description) && (
          <div className="shrink-0 border-b border-border px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                {title && <h3 className="text-lg font-medium tracking-tight">{title}</h3>}
                {description && (
                  <p className="mt-1 text-sm text-foreground/60">{description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Schließen"
                className="rounded-lg p-1 text-foreground/60 hover:bg-tile-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        )}
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>;
}
