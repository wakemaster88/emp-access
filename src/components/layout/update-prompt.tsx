"use client";

import { Sparkles } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MAX_RELEASE_NOTES } from "@/lib/app-version";
import { useUpdateCheck } from "@/components/layout/use-update-check";

/** Liste der Neuerungen im Dialog: höchstens acht, der Rest als Zahl. */
function ReleaseNotes({ notes }: { notes: string[] }) {
  const shown = notes.slice(0, MAX_RELEASE_NOTES);
  const more = notes.length - shown.length;
  return (
    <div className="glass-tile max-h-[45dvh] overflow-y-auto px-3.5 py-3">
      <ul className="flex flex-col gap-2 text-sm">
        {shown.map((note) => (
          <li key={note} className="flex gap-2.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 break-words">{note}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-2 text-xs text-muted-foreground">und {more} weitere Änderungen</p>}
    </div>
  );
}

/**
 * Hinweis „Neue Version verfügbar“ nach einem Deployment, mit den Neuerungen
 * seit dem eigenen Stand (Titel der gemergten PRs, nur auf Seiten fürs Team).
 *
 * Vergleicht beim Zurückkehren in den Vordergrund, bei Fokus, nach dem
 * Wiederverbinden und alle 5 Minuten die eigene Build-ID mit `/api/version`.
 * Auf Seiten mit Person davor erscheint ein Dialog (Aktualisieren / Später),
 * aber nie über einer schon offenen Ebene. Kiosk-Seiten laden selbst neu,
 * sobald eine Minute lang niemand getippt hat.
 */
export function UpdatePrompt() {
  const { target, notes, open, onOpenChange, apply } = useUpdateCheck();
  if (!target) return null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Neue Version verfügbar"
      description={
        notes.length > 0
          ? "Das ist neu. Nicht gespeicherte Eingaben auf dieser Seite gehen beim Aktualisieren verloren."
          : "EMP Access wurde aktualisiert. Lade die App neu, um die neue Version zu nutzen. Nicht gespeicherte Eingaben auf dieser Seite gehen dabei verloren."
      }
      confirmLabel="Aktualisieren"
      cancelLabel="Später"
      destructive={false}
      onConfirm={() => apply().then(() => new Promise<void>(() => {}))}
    >
      {notes.length > 0 && <ReleaseNotes notes={notes} />}
    </ConfirmDialog>
  );
}
