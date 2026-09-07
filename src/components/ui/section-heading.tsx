import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  title: string;
  icon?: LucideIcon;
  description?: string;
  /** Rechts ausgerichtet: Status-Badge, Zähler, kleiner Button. */
  aside?: React.ReactNode;
  className?: string;
  /** Für die Sprungmarke, z. B. `id="telegram"`. */
  id?: string;
}

/**
 * Überschrift eines Abschnitts auf einer Seite (Einstellungen, Detailseiten).
 * Gesperrte Kleinschrift mit Symbol, optional eine Erklärzeile darunter.
 */
export function SectionHeading({ title, icon: Icon, description, aside, className, id }: SectionHeadingProps) {
  return (
    <div id={id} className={cn("flex flex-col gap-1 scroll-mt-20", className)}>
      <div className="flex items-center gap-2 min-h-6">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
        <h2 className="text-label">{title}</h2>
        {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
