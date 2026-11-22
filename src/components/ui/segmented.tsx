"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
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
  /** Zusatzklassen nur für dieses Segment, z. B. die Markierung „heute“. */
  className?: string;
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
  /**
   * Die helle Pille gleitet beim Wechseln federnd zur neuen Wahl, wie die Linse
   * der Handy-Tab-Leiste. Für Leisten, deren Einträge stehen bleiben (Tage).
   * Mit „Bewegung reduzieren“ springt sie ohne Animation.
   */
  glide?: boolean;
  className?: string;
}

/** Feder wie die Linse der Handy-Tab-Leiste (mobile-tab-bar.tsx). */
const GLIDE_SPRING = "duration-500 ease-[cubic-bezier(0.32,1.4,0.56,1)] motion-reduce:transition-none";

interface PillBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
  glide = false,
  className,
  ...aria
}: SegmentedProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = React.useState<PillBox | null>(null);
  // Erste Messung ohne Übergang, sonst flöge die Pille beim Laden von links herein.
  const [animate, setAnimate] = React.useState(false);
  const activeIndex = options.findIndex((o) => o.value === value);

  React.useLayoutEffect(() => {
    if (!glide) return;
    const measure = () => {
      const el = refs.current[activeIndex];
      if (!el || el.offsetWidth === 0) {
        setPill(null);
        return;
      }
      setPill({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [glide, activeIndex, options]);

  React.useEffect(() => {
    if (!glide || !pill || animate) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [glide, pill, animate]);

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
      ref={stripRef}
      role="radiogroup"
      aria-label={aria["aria-label"]}
      className={segmentedStripClass(stretch, cn(glide && "relative", className))}
    >
      {glide && pill && (
        <span
          aria-hidden
          className={cn(
            "glass-pill-active pointer-events-none absolute left-0 top-0",
            animate && "transition-[transform,width,height]",
            animate && GLIDE_SPRING,
          )}
          style={{ width: pill.w, height: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }}
        />
      )}
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
            className={cn(
              // Gleitet die Pille, trägt die Taste selbst keine Fläche, nur die Schrift.
              segmentedItemClass(size, stretch, active && !(glide && pill)),
              glide && "relative",
              glide && active && "text-foreground",
              o.className,
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={segmentedCountClass(active)}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
