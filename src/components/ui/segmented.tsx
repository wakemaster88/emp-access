"use client";

import * as React from "react";
import {
  segmentedCountClass,
  segmentedItemClass,
  segmentedStripClass,
} from "@/components/ui/segmented-styles";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Kleine Zahl rechts im Segment (z. B. Anzahl Treffer). */
  count?: number;
  disabled?: boolean;
  /** Tooltip (natives `title`), z. B. für abgekürzte Beschriftungen. */
  title?: string;
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
 * Steht der Filter in der URL, `SegmentedLinks` (segmented-links.tsx) nehmen –
 * gleiches Aussehen, Links statt Tasten.
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
      className={segmentedStripClass(stretch, className)}
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
            title={o.title}
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
            className={segmentedItemClass(size, stretch, active)}
          >
            {o.label}
            {o.count !== undefined && <span className={segmentedCountClass(active)}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
