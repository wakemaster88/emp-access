"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Kleine Zahl rechts im Segment (z. B. Anzahl Treffer). */
  count?: number;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Name der Gruppe für Screenreader („Zeitraum“, „Ansicht“). */
  "aria-label": string;
  size?: "sm" | "md";
  /** Volle Breite, Segmente teilen sich den Platz gleichmäßig. */
  stretch?: boolean;
  className?: string;
}

/**
 * Segmentwahl (docs/design-regeln.md, Abschnitt 6): eine Glas-Kapsel mit
 * heller Pille für die aktive Wahl – für Filter, Zeiträume und Ansichten,
 * die keinen eigenen Inhaltsbereich umschalten (dafür `Tabs`).
 * Pfeiltasten wechseln die Wahl, wie bei einer Radiogruppe.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  stretch = false,
  className,
  ...aria
}: SegmentedProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, dir: 1 | -1) => {
    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const i = (from + dir * step + n) % n;
      if (!options[i].disabled) {
        onValueChange(options[i].value);
        refs.current[i]?.focus();
        return;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      className={cn(
        "glass-strip inline-flex max-w-full items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        stretch && "flex w-full",
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full whitespace-nowrap font-medium outline-none",
              "text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              size === "sm" ? "h-7 px-3 text-xs" : "h-[34px] px-3.5 text-[13px]",
              stretch && "flex-1",
              active && "glass-pill-active font-semibold text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-semibold tabular-nums leading-4",
                  active ? "bg-primary/15 text-primary" : "bg-foreground/[0.07] text-muted-foreground dark:bg-white/10",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
