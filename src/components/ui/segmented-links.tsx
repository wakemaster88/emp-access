import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  segmentedCountClass,
  segmentedIconClass,
  segmentedItemClass,
  segmentedStripClass,
  type SegmentedSize,
} from "@/components/ui/segmented-styles";

export interface SegmentedLinkOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Ziel des Segments, meist dieselbe Seite mit anderem Suchparameter. */
  href: string;
  icon?: LucideIcon;
  /** Kleine Zahl rechts im Segment (z. B. Anzahl Einträge). */
  count?: number;
  /** Tooltip (natives `title`). */
  title?: string;
}

interface SegmentedLinksProps<T extends string> {
  options: SegmentedLinkOption<T>[];
  /** Wert des aktiven Segments (aus der URL gelesen). */
  value: T;
  /** Name der Navigation für Screenreader („Status“, „Zeitraum“). */
  "aria-label": string;
  size?: SegmentedSize;
  /** Volle Breite, Segmente teilen sich den Platz gleichmäßig. */
  stretch?: boolean;
  className?: string;
}

/**
 * Segmentwahl mit Links (docs/design-regeln.md, Abschnitt 6): sieht aus wie
 * `Segmented`, für Filter, die in der URL stehen (`?status=…`). Rendert eine
 * `<nav>` mit Links; das aktive Segment trägt `aria-current="page"`.
 * Ohne Client-Zustand – funktioniert in Server-Komponenten.
 */
export function SegmentedLinks<T extends string>({
  options,
  value,
  size = "md",
  stretch = false,
  className,
  ...aria
}: SegmentedLinksProps<T>) {
  return (
    <nav
      data-slot="segmented-links"
      aria-label={aria["aria-label"]}
      className={segmentedStripClass(stretch, className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <Link
            key={o.value}
            href={o.href}
            data-slot="segmented-link"
            aria-current={active ? "page" : undefined}
            title={o.title}
            className={segmentedItemClass(size, stretch, active)}
          >
            {Icon && <Icon className={segmentedIconClass(size)} aria-hidden />}
            {o.label}
            {o.count !== undefined && <span className={segmentedCountClass(active)}>{o.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
