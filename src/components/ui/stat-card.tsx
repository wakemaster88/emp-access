import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTone = "primary" | "success" | "warning" | "danger" | "info" | "violet" | "neutral";

const TONE: Record<StatTone, { tile: string; text: string }> = {
  primary: { tile: "bg-primary/10 text-primary", text: "text-primary" },
  success: { tile: "bg-success/12 text-success", text: "text-success" },
  warning: { tile: "bg-warning/14 text-warning", text: "text-warning" },
  danger: { tile: "bg-destructive/12 text-destructive", text: "text-destructive" },
  info: { tile: "bg-info/12 text-info", text: "text-info" },
  violet: { tile: "bg-chart-5/12 text-chart-5", text: "text-chart-5" },
  neutral: { tile: "bg-muted text-muted-foreground", text: "text-muted-foreground" },
};

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Kleine Zeile unter dem Wert: Kontext, Vergleich, Einheit. */
  hint?: string;
  /** Prozentuale Veränderung; färbt sich nach Vorzeichen. */
  trend?: { value: number; label: string };
  /** Klickbar – die ganze Kachel führt dorthin. */
  href?: string;
  /** `sm` für Dialoge und dichte Raster ohne Symbolkachel. */
  size?: "sm" | "md";
  /** Wert in Akzentfarbe statt Vordergrund (z. B. Wachstum). */
  accentValue?: boolean;
  className?: string;
}

/**
 * Kennzahl-Kachel: gesperrte Beschriftung, große bündige Zahl, optional
 * Symbolkachel und Kontextzeile. Eine Komponente für Dashboard, Auswertung,
 * Netzwerk, Abos, Bewässerung – damit Zahlen überall gleich aussehen.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "primary",
  hint,
  trend,
  href,
  size = "md",
  accentValue = false,
  className,
}: StatCardProps) {
  const t = TONE[tone];
  const sm = size === "sm";

  const body = (
    <Card
      className={cn(
        "gap-0 h-full min-w-0",
        sm ? "px-3 py-2.5 rounded-lg" : "px-4 py-3.5 sm:px-5 sm:py-4",
        href && "transition-[box-shadow,border-color,transform] hover:-translate-y-px hover:shadow-md hover:border-primary/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <p className={cn("text-label truncate", sm && "text-[10px] tracking-[0.1em]")}>{label}</p>
          <p
            className={cn(
              "font-semibold tabular-nums tracking-tight truncate",
              sm ? "text-xl mt-0.5" : "text-2xl sm:text-[1.75rem] mt-1 leading-tight",
              accentValue ? t.text : "text-foreground",
            )}
          >
            {value}
          </p>
          {trend && (
            <p className={cn("text-xs mt-1 tabular-nums", trend.value >= 0 ? "text-success" : "text-destructive")}>
              {trend.value >= 0 ? "+" : ""}
              {trend.value}% {trend.label}
            </p>
          )}
          {hint && !trend && (
            <p className={cn("text-muted-foreground truncate", sm ? "text-[11px] mt-0.5" : "text-xs mt-1")}>{hint}</p>
          )}
        </div>
        {Icon && !sm && (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", t.tile)}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        {Icon && sm && <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", t.text)} />}
      </div>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {body}
      </Link>
    );
  }
  return body;
}
