import { Bell } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { cn } from "@/lib/utils";

interface PushPreviewProps {
  /** Absender wie auf dem Sperrbildschirm, z. B. „Ride Pass“. */
  app: string;
  title: string;
  body: string;
  className?: string;
}

/** So ungefähr sieht eine Push-Nachricht auf dem Handy aus (Vorschau vor dem Senden). */
export function PushPreview({ app, title, body, className }: PushPreviewProps) {
  return (
    <div
      className={cn("flex items-start gap-3 rounded-xl border border-glass-tile-border bg-glass-tile p-3", className)}
      aria-label="Vorschau der Push-Nachricht"
    >
      <IconChip icon={Bell} tone="primary" size="md" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{app}</span>
          <span className="shrink-0">jetzt</span>
        </div>
        <p className="text-sm font-semibold text-foreground break-words">{title}</p>
        <p className="text-sm text-muted-foreground break-words">{body}</p>
      </div>
    </div>
  );
}
