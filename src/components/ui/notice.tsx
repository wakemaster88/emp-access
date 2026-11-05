import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "success" | "warning" | "danger" | "neutral";

const TONE: Record<NoticeTone, { box: string; chip: string; text: string; icon: LucideIcon }> = {
  info: {
    box: "border-info/40 bg-gradient-to-br from-info/14 to-info/[0.03]",
    chip: "bg-info text-info-foreground",
    text: "text-info",
    icon: Info,
  },
  success: {
    box: "border-success/40 bg-gradient-to-br from-success/14 to-success/[0.03]",
    chip: "bg-success text-success-foreground",
    text: "text-success",
    icon: CheckCircle2,
  },
  warning: {
    box: "border-warning/45 bg-gradient-to-br from-warning/16 to-warning/[0.03]",
    chip: "bg-warning text-warning-foreground",
    text: "text-warning",
    icon: AlertTriangle,
  },
  danger: {
    box: "border-destructive/45 bg-gradient-to-br from-destructive/14 to-destructive/[0.03]",
    chip: "bg-destructive text-white",
    text: "text-destructive",
    icon: OctagonAlert,
  },
  neutral: {
    box: "border-glass-border bg-glass-tile",
    chip: "bg-glass-strong text-muted-foreground ring-1 ring-inset ring-glass-border",
    text: "text-muted-foreground",
    icon: Info,
  },
};

interface NoticeProps {
  tone?: NoticeTone;
  /** Eigenes Symbol; sonst das passende zur Tönung. `null` blendet es aus. */
  icon?: LucideIcon | null;
  /** Eine Zeile: was passiert ist. */
  title?: React.ReactNode;
  /** Was zu tun ist oder was es bedeutet. */
  children?: React.ReactNode;
  /** Rechts: Taste oder Link für den nächsten Schritt. */
  action?: React.ReactNode;
  /** Kompakt für Karten und Dialoge (kleiner Chip, weniger Abstand). */
  compact?: boolean;
  className?: string;
  /** `alert` für Fehler, die gerade erst auftreten (Screenreader sagt sie an). */
  role?: "status" | "alert";
}

/**
 * Hinweis-Kachel (docs/design-regeln.md, Abschnitt 14): Störung, Warnung,
 * Erfolg oder Information als getönte Kachel mit Symbol-Chip, Titelzeile,
 * Erklärung und optionaler Handlung – wie die Störungszeile in den
 * Raum-Mockups. Ersetzt handgebaute `bg-amber-50 border-amber-200 …`-Kästen.
 *
 * Sparsam einsetzen: Ruhe bei Normalbetrieb. Ein Hinweis, der nichts
 * fordert, gehört nicht auf die Seite.
 */
export function Notice({
  tone = "info",
  icon,
  title,
  children,
  action,
  compact = false,
  className,
  role,
}: NoticeProps) {
  const t = TONE[tone];
  const Icon = icon === null ? null : (icon ?? t.icon);
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "flex min-w-0 flex-wrap items-start gap-3 rounded-tile border sm:flex-nowrap",
        compact ? "px-3 py-2.5" : "px-3.5 py-3",
        t.box,
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl",
            compact ? "mt-px size-6" : "size-8",
            t.chip,
          )}
          aria-hidden
        >
          <Icon className={compact ? "size-3.5" : "size-4"} strokeWidth={2.2} />
        </span>
      )}
      <div className={cn("min-w-0 flex-1", Icon && !compact && "pt-0.5")}>
        {title && <p className={cn("font-semibold text-foreground", compact ? "text-[13px]" : "text-sm")}>{title}</p>}
        {children && (
          <div className={cn("text-muted-foreground", compact ? "text-xs" : "text-[13px]", title && "mt-0.5")}>
            {children}
          </div>
        )}
      </div>
      {action && (
        <div className="flex shrink-0 items-center justify-end gap-2 self-center max-sm:basis-full">{action}</div>
      )}
    </div>
  );
}

/** Farbe der Hinweis-Tönung als Textklasse (für Werte, die zum Hinweis gehören). */
export function noticeTextClass(tone: NoticeTone): string {
  return TONE[tone].text;
}
