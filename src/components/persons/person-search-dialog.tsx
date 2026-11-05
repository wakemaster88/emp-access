"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Match {
  id: number;
  score: number;
  seenAt: string;
  camera: string | null;
}

interface SearchResult {
  matches: Match[];
  scanned: number;
  pending: number;
  samples: number;
  preselect: number;
}

/**
 * „In Unbekannten suchen“: zeigt unzugeordnete Sichtungen, die der Person
 * aehneln. Sichere Treffer sind vorausgewaehlt, ein Tipp schaltet um.
 */
export function PersonSearchDialog({
  person,
  onClose,
  onAssigned,
}: {
  person: { id: number; name: string } | null;
  onClose: () => void;
  onAssigned: (msg: string) => void;
}) {
  const [data, setData] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!person) return;
    let cancelled = false;
    setData(null);
    setError("");
    setSelected(new Set());
    fetch(`/api/persons/${person.id}/similar-unknown`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof body.error === "string" ? body.error : "Suche fehlgeschlagen");
          return;
        }
        const result = body as SearchResult;
        setData(result);
        setSelected(new Set(result.matches.filter((m) => m.score >= result.preselect).map((m) => m.id)));
      })
      .catch(() => !cancelled && setError("Suche fehlgeschlagen"));
    return () => {
      cancelled = true;
    };
  }, [person]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (!person || selected.size === 0) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/person-sightings/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sightingIds: [...selected], listedPersonId: person.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Zuordnen fehlgeschlagen");
        return;
      }
      const samples = (body.samples ?? 0) + (body.enrollTasks ?? 0);
      onAssigned(
        `${body.assigned} Sichtung${body.assigned === 1 ? "" : "en"} → ${body.name}` +
          (samples ? ` · ${samples} neue Gesichts-Sample${samples === 1 ? "" : "s"}` : "")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{person?.name} in Unbekannten suchen</DialogTitle>
        </DialogHeader>

        {!data && !error && (
          <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Gesichter werden verglichen …
          </div>
        )}
        {error && <Notice tone="danger" compact title={error} />}

        {data && (
          <div className="space-y-3">
            {/* Auswahlhilfen neben der Trefferzahl, nicht in der Fußleiste (dort nur Schließen und Zuordnen, Abschnitt 16). */}
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {data.samples === 0
                  ? "Diese Person hat noch keine Gesichts-Samples. Erst eine Sichtung zuordnen, dann kann gesucht werden."
                  : <>
                      {data.scanned} unbekannte Gesichter verglichen, {data.matches.length} ähnlich.
                      Ab {Math.round(data.preselect * 100)} % vorausgewählt; antippen zum Ändern.
                    </>}
                {data.pending > 0 && (
                  <> {data.pending} Sichtungen sind noch nicht analysiert und fehlen in der Suche.</>
                )}
              </p>
              {data.matches.length > 0 && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="max-sm:h-11">Keine</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set(data.matches.map((m) => m.id)))}
                    className="max-sm:h-11"
                  >
                    Alle
                  </Button>
                </div>
              )}
            </div>

            {data.matches.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {data.matches.map((m) => {
                  const on = selected.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(m.id)}
                      aria-pressed={on}
                      className={cn(
                        "press relative rounded-xl border overflow-hidden text-left bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        on ? "border-primary ring-2 ring-primary" : "border-glass-border opacity-60 hover:opacity-90"
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/person-sightings/${m.id}/snapshot`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="aspect-square w-full object-cover"
                      />
                      {on && (
                        <span className="absolute top-1 right-1 rounded-full bg-primary-fill p-0.5 text-primary-foreground">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      )}
                      {/* Ähnlichkeit als Pille über dem Kamerabild (Badge media). */}
                      <Badge variant="media" className="absolute top-1 left-1 tabular-nums">
                        {Math.round(m.score * 100)}%
                      </Badge>
                      <span className="block px-1.5 py-1 text-[11px] text-muted-foreground truncate">
                        {new Date(m.seenAt).toLocaleString("de-DE", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
                        {m.camera ? ` · ${m.camera}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="max-sm:h-11">Schließen</Button>
          <Button onClick={assign} disabled={busy || selected.size === 0} className="gap-1.5 tabular-nums max-sm:h-11">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {selected.size} zuordnen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
