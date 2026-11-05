import { cn } from "@/lib/utils";

/**
 * Gemeinsame Klassen für `Segmented` (Tasten) und `SegmentedLinks` (Links),
 * damit beide gleich aussehen und nicht auseinanderlaufen. Bewusst ohne
 * "use client": `SegmentedLinks` läuft auch in Server-Komponenten.
 */

export type SegmentedSize = "sm" | "md";

/**
 * Glas-Kapsel. Passt sie nicht in eine Zeile, bricht sie um und die Segmente
 * füllen jede Zeile – nie seitlich scrollen (docs/design-regeln.md, Abschnitt 6).
 */
export function segmentedStripClass(stretch: boolean, className?: string) {
  return cn(
    "glass-strip inline-flex max-w-full flex-wrap items-center gap-x-0.5 gap-y-1",
    stretch && "flex w-full",
    className,
  );
}

/** Ein Segment; aktiv hebt es die helle Pille hervor. */
export function segmentedItemClass(size: SegmentedSize, stretch: boolean, active: boolean) {
  return cn(
    "press inline-flex shrink-0 grow items-center justify-center gap-1.5 rounded-full whitespace-nowrap font-medium outline-none",
    "text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-7 px-3 text-xs" : "h-[34px] px-3.5 text-[13px]",
    stretch && "flex-1",
    active && "glass-pill-active font-semibold text-foreground",
  );
}

/**
 * Zahl im Segment. Aktiv hell `text-primary` auf `primary/15` (4,6:1 auf der
 * Pille), dunkel Vordergrund auf `primary/25` (6,7:1) – `text-primary` käme
 * im Dunkeln nur auf 2:1.
 */
export function segmentedCountClass(active: boolean) {
  return cn(
    "rounded-full px-1.5 text-[10px] font-semibold tabular-nums leading-4",
    active
      ? "bg-primary/15 text-primary dark:bg-primary/25 dark:text-foreground"
      : "bg-foreground/[0.07] text-muted-foreground dark:bg-white/10",
  );
}

/** Symbol im Segment. */
export function segmentedIconClass(size: SegmentedSize) {
  return size === "sm" ? "size-3 shrink-0" : "size-3.5 shrink-0";
}
