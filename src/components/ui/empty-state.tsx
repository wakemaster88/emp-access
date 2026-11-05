import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  /** Der Satz, der sagt, was hier stehen würde. Darf Hervorhebungen oder Links enthalten. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Meist der „Anlegen“-Button oder ein Link. */
  action?: React.ReactNode;
  className?: string;
  /** Kompakt für Tabellenzellen (`TableEmpty`) und kleine Karten. */
  compact?: boolean;
  /**
   * `sm`: noch kleiner als `compact` – für Kacheln und Picker-Listen
   * (`Checklist`), wenig Abstand, kleines Symbol.
   */
  size?: "default" | "sm";
}

/**
 * Leerer Zustand: ein Satz, der sagt, was hier stehen würde, und der nächste
 * Schritt (docs/design-regeln.md, Abschnitt 11: „Leere Zustände sind ein
 * Satz, keine Grafik“). Das Symbol ist klein und gedämpft. Einheitlich für
 * Tabellen ohne Zeilen, Listen ohne Einträge und Bereiche ohne Konfiguration.
 */
export function EmptyState({ icon: Icon, title, description, action, className, compact, size = "default" }: EmptyStateProps) {
  const sm = size === "sm";
  // `sm` geht vor `compact`; `compact` bleibt die mittlere Größe.
  const small = sm || compact;
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        sm ? "gap-1.5 px-3 py-4" : compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-glass-tile text-muted-foreground ring-1 ring-inset ring-glass-border",
            sm ? "size-8" : compact ? "h-9 w-9" : "h-11 w-11",
          )}
        >
          <Icon className={small ? "h-4 w-4" : "h-5 w-5"} />
        </div>
      )}
      <div className={sm ? "space-y-0.5" : "space-y-1"}>
        <div className={cn("font-semibold text-foreground", sm ? "text-[13px]" : compact ? "text-sm" : "text-[15px]")}>
          {title}
        </div>
        {description && (
          <div className={cn("text-muted-foreground max-w-sm", small ? "text-xs" : "text-sm")}>{description}</div>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
