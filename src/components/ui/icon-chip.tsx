import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Farbtöne für Symbol-Chips. Die Zustandsfarben folgen dem festen Vokabular
 * aus docs/design-regeln.md, Abschnitt 3 (Licht amber, Musik violet, Heizen
 * orange, Lüften/Wasser sky, Live emerald, Störung destructive, Hinweis
 * warning, aus/ruhig neutral). `primary` ist der Akzent für Navigation und
 * Auswahl, keine Zustandsfarbe.
 */
export type ChipTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "light"
  | "music"
  | "heat"
  | "water"
  | "live";

const SOFT: Record<ChipTone, string> = {
  neutral: "text-muted-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
  light: "text-amber-500 dark:text-amber-300",
  music: "text-violet-600 dark:text-violet-300",
  heat: "text-orange-600 dark:text-orange-400",
  water: "text-sky-600 dark:text-sky-400",
  live: "text-emerald-600 dark:text-emerald-400",
};

const SOLID: Record<ChipTone, string> = {
  neutral: "bg-muted-foreground text-background",
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive text-white",
  info: "bg-info text-info-foreground",
  light: "bg-amber-400 text-amber-950",
  music: "bg-violet-400 text-violet-950",
  heat: "bg-orange-400 text-orange-950",
  water: "bg-sky-400 text-sky-950",
  live: "bg-emerald-400 text-emerald-950",
};

const SIZE = {
  sm: "size-7 rounded-[10px] [&_svg]:size-3.5",
  md: "size-8 rounded-xl [&_svg]:size-4",
  lg: "size-10 rounded-control [&_svg]:size-5",
} as const;

interface IconChipProps {
  icon: LucideIcon;
  tone?: ChipTone;
  /**
   * `true`: Zustand ist an – der Chip füllt sich in seiner Farbe (wie eine
   * eingeschaltete Lampe in den Raum-Kacheln). Sonst Glas mit farbigem Symbol.
   */
  active?: boolean;
  size?: keyof typeof SIZE;
  className?: string;
  /** Screenreader-Text, wenn das Symbol eine eigene Aussage trägt. */
  label?: string;
}

/**
 * Symbol im runden Glas-Quadrat – vor Listenzeilen, in Kacheln, in
 * Kennzahlen. Aus: Glas mit farbigem Symbol. An: volle Farbe, dunkles Symbol.
 */
export function IconChip({ icon: Icon, tone = "neutral", active = false, size = "md", className, label }: IconChipProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        SIZE[size],
        active ? SOLID[tone] : cn("bg-glass-tile ring-1 ring-inset ring-glass-border", SOFT[tone]),
        className,
      )}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Icon strokeWidth={2.2} />
    </span>
  );
}
