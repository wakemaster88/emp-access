import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Meist der „Anlegen“-Button oder ein Link. */
  action?: React.ReactNode;
  className?: string;
  /** Kompakt für Tabellenzellen und kleine Karten. */
  compact?: boolean;
}

/**
 * Leerer Zustand: ein Satz, der sagt, was hier stehen würde, und der nächste
 * Schritt (docs/design-regeln.md, Abschnitt 11: „Leere Zustände sind ein
 * Satz, keine Grafik“). Das Symbol ist klein und gedämpft. Einheitlich für
 * Tabellen ohne Zeilen, Listen ohne Einträge und Bereiche ohne Konfiguration.
 */
export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-glass-tile text-muted-foreground ring-1 ring-inset ring-glass-border",
            compact ? "h-9 w-9" : "h-11 w-11",
          )}
        >
          <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </div>
      )}
      <div className="space-y-1">
        <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-[15px]")}>{title}</p>
        {description && (
          <p className={cn("text-muted-foreground max-w-sm", compact ? "text-xs" : "text-sm")}>{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
