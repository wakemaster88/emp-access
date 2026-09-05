"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw } from "lucide-react";

type Service = "tracker" | "hub";

interface RestartResult {
  service: Service;
  restarted?: boolean;
  healthy?: boolean;
  waitedMs?: number;
  note?: string;
  health?: { model?: string; workers?: string[] } | null;
}

interface TaskRow {
  status: string;
  result: RestartResult | null;
  error: string | null;
}

const POLL_MS = 2_000;
/** Tracker-Neustart wartet am Hub bis 30 s auf /health; dazu Poll-Latenz. */
const TIMEOUT_MS = 75_000;

/**
 * Startet einen lokalen Dienst über einen SERVICE_RESTART-Task neu. Der Hub
 * kennt nur „tracker“ (launchctl) und „hub“ (eigener Exit, launchd startet
 * neu). Rückfrage vor dem Absenden, weil Zähler und Erkennung kurz aussetzen.
 */
export function HubRestartButton({
  service,
  label,
  confirmText,
}: {
  service: Service;
  label: string;
  confirmText: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    if (!confirm(confirmText)) return;
    setBusy(true);
    setNote(null);
    try {
      const created = await fetch("/api/hub/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SERVICE_RESTART", payload: { service } }),
      });
      if (!created.ok) throw new Error(`Task konnte nicht angelegt werden (HTTP ${created.status})`);
      const task = (await created.json()) as { id: number };

      const started = Date.now();
      while (Date.now() - started < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const res = await fetch(`/api/hub/tasks/${task.id}`, { cache: "no-store" });
        if (!res.ok) continue;
        const row = (await res.json()) as TaskRow;
        if (row.status === "DONE") {
          const r = row.result;
          if (service === "hub") {
            setNote({ ok: true, text: "Hub startet neu, in etwa 10 Sekunden wieder da." });
          } else if (r?.healthy) {
            setNote({
              ok: true,
              text: `Tracker läuft wieder (nach ${Math.round((r.waitedMs ?? 0) / 1000)} s${r.health?.model ? `, ${r.health.model}` : ""}).`,
            });
          } else {
            setNote({ ok: false, text: "Tracker neu gestartet, antwortet aber noch nicht. Log prüfen." });
          }
          return;
        }
        if (row.status === "FAILED") throw new Error(row.error || "Hub meldet einen Fehler");
      }
      throw new Error("Keine Antwort vom Hub innerhalb von 75 s.");
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={run} disabled={busy} className="gap-1.5">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        {busy ? "Warte auf Hub …" : label}
      </Button>
      {note && (
        <span className={"text-xs " + (note.ok ? "text-muted-foreground" : "text-destructive")}>{note.text}</span>
      )}
    </span>
  );
}
