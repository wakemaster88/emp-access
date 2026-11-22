import { cn } from "@/lib/utils";

export interface Segment {
  /** Kurzname für Screenreader und Kurzinfo („Erlaubt“, „Bekannt“). */
  label: string;
  value: number;
  /** Füllung als Klasse, z. B. `bg-success` oder `bg-chart-1`. */
  className: string;
}

interface SegmentBarProps {
  segments: Segment[];
  /**
   * Bezugsgröße für die Breite. Ohne Angabe füllt die Summe die Leiste;
   * mit `max` wird sie anteilig kürzer (Zeilen untereinander vergleichbar).
   */
  max?: number;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Anteile als eine dünne Leiste (docs/design-regeln.md, Abschnitt 8):
 * erlaubt/abgelehnt, bekannt/unbekannt/gesperrt, Personen/Fahrzeuge je
 * Kamera. Zwischen den Teilen 2 px Lücke in der Kartenfarbe, die Enden
 * gerundet. Die Werte stehen zusätzlich als Text für Screenreader (Farbe
 * trägt nie allein).
 */
export function SegmentBar({ segments, max, size = "sm", className }: SegmentBarProps) {
  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const base = Math.max(max ?? total, total, 1);
  const filled = (total / base) * 100;
  const text = visible.map((s) => `${s.label} ${s.value.toLocaleString("de-DE")}`).join(", ");

  return (
    <span
      className={cn(
        "block overflow-hidden rounded-full bg-foreground/[0.08] dark:bg-white/[0.08]",
        size === "md" ? "h-2" : "h-1.5",
        className,
      )}
    >
      <span className="flex h-full gap-[2px]" style={{ width: `${filled}%` }} aria-hidden>
        {visible.map((s) => (
          <span
            key={s.label}
            className={cn("block h-full min-w-[2px] first:rounded-l-full last:rounded-r-full", s.className)}
            style={{ flexGrow: s.value, flexBasis: 0 }}
          />
        ))}
      </span>
      {text && <span className="sr-only">{text}</span>}
    </span>
  );
}
