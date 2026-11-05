import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Töne der Kennzahl. `light`, `music`, `heat`, `water` und `live` sind das
 * Zustandsvokabular aus docs/design-regeln.md, Abschnitt 3 – dieselben Namen
 * und Symbolfarben wie bei `IconChip`.
 */
export type StatTone =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "violet"
  | "neutral"
  | "light"
  | "music"
  | "heat"
  | "water"
  | "live";

const TONE: Record<StatTone, { icon: string; text: string; bar: string; outline: string; solid: string }> = {
  primary: { icon: "text-primary", text: "text-primary", bar: "bg-primary", outline: "outline-primary/70", solid: "bg-primary-fill text-primary-foreground" },
  success: { icon: "text-success", text: "text-success", bar: "bg-success", outline: "outline-success/70", solid: "bg-success text-success-foreground" },
  warning: { icon: "text-warning", text: "text-warning", bar: "bg-warning", outline: "outline-warning/70", solid: "bg-warning text-warning-foreground" },
  danger: { icon: "text-destructive", text: "text-destructive", bar: "bg-destructive", outline: "outline-destructive/70", solid: "bg-destructive-fill text-white" },
  info: { icon: "text-info", text: "text-info", bar: "bg-info", outline: "outline-info/70", solid: "bg-info text-info-foreground" },
  violet: { icon: "text-chart-5", text: "text-chart-5", bar: "bg-chart-5", outline: "outline-chart-5/70", solid: "bg-chart-5 text-white" },
  neutral: { icon: "text-muted-foreground", text: "text-muted-foreground", bar: "bg-muted-foreground/60", outline: "outline-foreground/40", solid: "bg-muted-foreground text-background" },
  // Zustandsvokabular: Symbol wie IconChip, Zahl hell im 700er-Ton (≥ 4,5:1 auf Glas), dunkel 300.
  // Rahmen des aktiven Filters deckend, hell 600/700, dunkel 400: mindestens 3:1 gegen Karte und
  // Grund (hell 3,4 bis 5,5:1, dunkel ab 6,3:1) – bei `size="sm"` ist er das einzige Zeichen.
  light: { icon: "text-amber-500 dark:text-amber-300", text: "text-amber-700 dark:text-amber-300", bar: "bg-amber-500 dark:bg-amber-400", outline: "outline-amber-700 dark:outline-amber-400", solid: "bg-amber-400 text-amber-950" },
  music: { icon: "text-violet-600 dark:text-violet-300", text: "text-violet-700 dark:text-violet-300", bar: "bg-violet-500 dark:bg-violet-400", outline: "outline-violet-600 dark:outline-violet-400", solid: "bg-violet-400 text-violet-950" },
  heat: { icon: "text-orange-600 dark:text-orange-400", text: "text-orange-700 dark:text-orange-300", bar: "bg-orange-500 dark:bg-orange-400", outline: "outline-orange-600 dark:outline-orange-400", solid: "bg-orange-400 text-orange-950" },
  water: { icon: "text-sky-600 dark:text-sky-400", text: "text-sky-700 dark:text-sky-300", bar: "bg-sky-500 dark:bg-sky-400", outline: "outline-sky-600 dark:outline-sky-400", solid: "bg-sky-400 text-sky-950" },
  live: { icon: "text-emerald-600 dark:text-emerald-400", text: "text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500 dark:bg-emerald-400", outline: "outline-emerald-600 dark:outline-emerald-400", solid: "bg-emerald-400 text-emerald-950" },
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
  /**
   * `true`: der Hinweis steht unter dem Trend, beide sind sichtbar. Ohne
   * blendet ein Trend den Hinweis aus (bisheriges Verhalten, auf das sich
   * bestehende Kacheln verlassen).
   */
  hintWithTrend?: boolean;
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
  /** Zusätzliche Klassen für die Zahl, z. B. `font-mono` für Kennzeichen. */
  valueClassName?: string;
  /**
   * `tile` für Kennzahlen innerhalb einer Karte: `glass-tile` ohne eigenen
   * Weichzeichner (kein Glas auf Glas mit doppeltem Blur).
   */
  variant?: "card" | "tile";
  /**
   * Eigener Inhalt am unteren Rand (Zeilen, Mini-Balken, Hinweis-Badges).
   * Bei `href`/`onClick` keine Tasten oder Links hineinlegen.
   */
  children?: ReactNode;
  /**
   * Mit `href` oder `onClick` am äußeren Link bzw. an der Taste (damit
   * Rasterklassen wie `col-span-2` greifen), sonst an der Kachel selbst.
   */
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
  hintWithTrend = false,
  progress,
  href,
  onClick,
  active = false,
  size = "md",
  accentValue = false,
  valueClassName,
  variant = "card",
  children,
  className,
}: StatCardProps) {
  const t = TONE[tone];
  const sm = size === "sm";
  const tile = variant === "tile";
  const interactive = !!href || !!onClick;
  const pct = progress === undefined ? null : Math.max(0, Math.min(1, progress));

  const body = (
    <div
      data-slot="stat-card"
      className={cn(
        tile ? "glass-tile" : "glass-card",
        "flex h-full min-w-0 flex-col text-left",
        sm ? "gap-0.5 rounded-tile px-3 py-2.5" : cn("gap-2 px-3.5 pt-3 pb-3", tile ? "rounded-tile" : "rounded-[20px]"),
        interactive && "press hover:-translate-y-0.5 hover:bg-glass-strong",
        // Aktiver Filter: Rahmen in der Farbe der Kennzahl (Outline, weil
        // glass-card den Schatten schon für Lichtkante und Tiefe nutzt).
        active && cn("outline-2 -outline-offset-1", t.outline),
        !interactive && className,
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
            // Handy: zwei Zeilen statt mitten im Wort abgeschnitten (schmale Kacheln).
            "min-w-0 truncate max-sm:line-clamp-2 max-sm:whitespace-normal",
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
          valueClassName,
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
      {hint && (!trend || hintWithTrend) && (
        <p className={cn("truncate text-muted-foreground max-sm:line-clamp-2 max-sm:whitespace-normal", sm ? "text-[11px]" : "text-xs")}>{hint}</p>
      )}

      {pct !== null && !sm && (
        <span className="mt-auto block h-1 overflow-hidden rounded-full bg-foreground/[0.08] dark:bg-white/[0.08]" aria-hidden>
          <span className={cn("block h-full rounded-full transition-[width] duration-300", t.bar)} style={{ width: `${pct * 100}%` }} />
        </span>
      )}

      {children != null && children !== false && (
        <div data-slot="stat-card-content" className={cn("min-w-0", (pct === null || sm) && "mt-auto")}>
          {children}
        </div>
      )}
    </div>
  );

  // Rahmen der Taste bzw. des Links: trägt `className`, damit Rasterspalten greifen.
  const wrapperClass = cn(
    "block h-full min-w-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    tile ? "rounded-tile" : "rounded-[20px]",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={wrapperClass}
      >
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className={wrapperClass}>
        {body}
      </Link>
    );
  }
  return body;
}
