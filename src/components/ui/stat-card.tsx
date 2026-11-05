import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "primary" | "success" | "warning" | "danger" | "info" | "violet" | "neutral";

const TONE: Record<StatTone, { icon: string; text: string; bar: string; outline: string; solid: string }> = {
  primary: { icon: "text-primary", text: "text-primary", bar: "bg-primary", outline: "outline-primary/70", solid: "bg-primary text-primary-foreground" },
  success: { icon: "text-success", text: "text-success", bar: "bg-success", outline: "outline-success/70", solid: "bg-success text-success-foreground" },
  warning: { icon: "text-warning", text: "text-warning", bar: "bg-warning", outline: "outline-warning/70", solid: "bg-warning text-warning-foreground" },
  danger: { icon: "text-destructive", text: "text-destructive", bar: "bg-destructive", outline: "outline-destructive/70", solid: "bg-destructive text-white" },
  info: { icon: "text-info", text: "text-info", bar: "bg-info", outline: "outline-info/70", solid: "bg-info text-info-foreground" },
  violet: { icon: "text-chart-5", text: "text-chart-5", bar: "bg-chart-5", outline: "outline-chart-5/70", solid: "bg-chart-5 text-white" },
  neutral: { icon: "text-muted-foreground", text: "text-muted-foreground", bar: "bg-muted-foreground/60", outline: "outline-foreground/40", solid: "bg-muted-foreground text-background" },
};

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Bezug direkt hinter der Zahl, klein und gedämpft: „von 10“, „Räume“, „%“. */
  suffix?: string;
  /** Kleine Zeile unter dem Wert: Kontext, Vergleich, Einheit. */
  hint?: ReactNode;
  /** Prozentuale Veränderung; färbt sich nach Vorzeichen. */
  trend?: { value: number; label: string };
  /** Anteil 0…1 als dünner Balken unter der Zahl (z. B. 6 von 10 geöffnet). */
  progress?: number;
  /** Klickbar – die ganze Kachel führt dorthin. */
  href?: string;
  /**
   * Kennzahl als Filter: Antippen ruft `onClick`, `active` hebt die Kachel
   * in ihrer Farbe hervor (Rahmen, Symbol voll). Rendert eine Taste mit
   * `aria-pressed`.
   */
  onClick?: () => void;
  active?: boolean;
  /** `sm` für Dialoge und dichte Raster ohne Symbol-Chip und Balken. */
  size?: "sm" | "md";
  /** Wert in Akzentfarbe statt Vordergrund (z. B. Wachstum). */
  accentValue?: boolean;
  className?: string;
}

/**
 * Kennzahl-Kachel (docs/design-regeln.md, Abschnitt 8): Symbol-Chip und
 * Beschriftung oben, große bündige Zahl mit Bezug, optional ein dünner
 * Balken. Eine Komponente für Dashboard, Auswertung, Netzwerk, Abos,
 * Bewässerung und die Raum-Übersicht – damit Zahlen überall gleich aussehen.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "primary",
  suffix,
  hint,
  trend,
  progress,
  href,
  onClick,
  active = false,
  size = "md",
  accentValue = false,
  className,
}: StatCardProps) {
  const t = TONE[tone];
  const sm = size === "sm";
  const interactive = !!href || !!onClick;
  const pct = progress === undefined ? null : Math.max(0, Math.min(1, progress));

  const body = (
    <div
      data-slot="stat-card"
      className={cn(
        "glass-card flex h-full min-w-0 flex-col text-left",
        sm ? "gap-0.5 rounded-tile px-3 py-2.5" : "gap-2 rounded-[20px] px-3.5 pt-3 pb-3",
        interactive && "press hover:-translate-y-0.5 hover:bg-glass-strong",
        // Aktiver Filter: Rahmen in der Farbe der Kennzahl (Outline, weil
        // glass-card den Schatten schon für Lichtkante und Tiefe nutzt).
        active && cn("outline-2 -outline-offset-1", t.outline),
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {Icon && !sm && (
          <span
            className={cn(
              "flex size-[26px] shrink-0 items-center justify-center rounded-xl",
              active ? t.solid : cn("bg-glass-tile ring-1 ring-inset ring-glass-border", t.icon),
            )}
          >
            <Icon className="size-3.5" strokeWidth={2.2} />
          </span>
        )}
        <span
          className={cn(
            "min-w-0 truncate",
            sm ? "text-label text-[10px] tracking-[0.1em]" : "text-xs text-muted-foreground",
            active && !sm && "font-semibold text-foreground",
          )}
        >
          {label}
        </span>
        {Icon && sm && <Icon className={cn("ml-auto size-3.5 shrink-0", t.icon)} />}
      </div>

      <p
        className={cn(
          "min-w-0 truncate font-bold leading-none tracking-tight tabular-nums",
          sm ? "mt-1 text-xl" : "text-2xl",
          accentValue ? t.text : "text-foreground",
        )}
      >
        {value}
        {suffix && <span className="ml-1.5 text-xs font-medium tracking-normal text-muted-foreground">{suffix}</span>}
      </p>

      {trend && (
        <p className={cn("text-xs tabular-nums", trend.value >= 0 ? "text-success" : "text-destructive")}>
          {trend.value >= 0 ? "+" : ""}
          {trend.value}% {trend.label}
        </p>
      )}
      {hint && !trend && (
        <p className={cn("truncate text-muted-foreground", sm ? "text-[11px]" : "text-xs")}>{hint}</p>
      )}

      {pct !== null && !sm && (
        <span className="mt-auto block h-1 overflow-hidden rounded-full bg-foreground/[0.08] dark:bg-white/[0.08]" aria-hidden>
          <span className={cn("block h-full rounded-full transition-[width] duration-300", t.bar)} style={{ width: `${pct * 100}%` }} />
        </span>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="block h-full min-w-0 rounded-[20px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className="block h-full min-w-0 rounded-[20px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {body}
      </Link>
    );
  }
  return body;
}
