"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { AuditEvent } from "@/lib/audit";

const ACTION_LABELS: Record<string, string> = {
  ptz: "PTZ",
  spotlight: "Spotlight",
  ir: "Nachtsicht",
  "siren-start": "Sirene gestartet",
  "siren-stop": "Sirene gestoppt",
  "preset-go": "Preset",
  "preset-save": "Preset gespeichert",
  "doorbird-ring": "Klingel",
  "doorbird-open": "Tür geöffnet",
};

function relTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `vor ${Math.floor(diff / 1000)} s`;
  if (diff < 3_600_000) return `vor ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `vor ${Math.floor(diff / 3_600_000)} h`;
  return d.toLocaleString("de-DE");
}

export default function EventsPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const r = await fetch("/api/events?limit=200", { cache: "no-store" });
    const j = await r.json();
    setEvents(j.events ?? []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Ereignis-Log"
        description="Audit-Log für alle Steuerungsaktionen, Sirenen-Auslösungen und Klingelvorgänge."
        actions={
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            Aktualisieren
          </Button>
        }
      />

      {events.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-foreground/60">
            Noch keine Ereignisse aufgezeichnet.
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-tile ring-1 ring-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-tile-accent/30 text-left text-xs uppercase tracking-wider text-foreground/60">
              <tr>
                <th className="px-4 py-3">Wann</th>
                <th className="px-4 py-3">Aktion</th>
                <th className="px-4 py-3">Ziel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-foreground/70 text-xs">
                    <div>{relTime(ev.ts)}</div>
                    <div className="text-foreground/40">
                      {new Date(ev.ts).toLocaleTimeString("de-DE")}
                    </div>
                  </td>
                  <td className="px-4 py-2">{ACTION_LABELS[ev.action] ?? ev.action}</td>
                  <td className="px-4 py-2 font-mono text-xs text-foreground/70">{ev.target ?? "—"}</td>
                  <td className="px-4 py-2">
                    {ev.ok === false ? (
                      <Badge variant="danger">Fehler</Badge>
                    ) : (
                      <Badge variant="success">ok</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 max-w-md truncate font-mono text-xs text-foreground/60">
                    {ev.meta ? JSON.stringify(ev.meta) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
