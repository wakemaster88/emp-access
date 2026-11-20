"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VIA_LABEL, describeEvent, type StocktakeEventLike } from "@/lib/stocktake-log";

export interface EventView extends StocktakeEventLike {
  id: number;
  createdAt: string;
}

const PREVIEW = 12;

const TYPE_BADGE: Record<string, { label: string; variant: "neutral" | "success" | "warning" | "info" }> = {
  SIGNED: { label: "Bestätigt", variant: "success" },
  SIGNATURE_VOID: { label: "Aufgehoben", variant: "warning" },
  CLOSED: { label: "Festgeschrieben", variant: "info" },
  CORRECTION: { label: "Korrektur", variant: "warning" },
};

function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Protokoll einer Inventur: wer hat wann was eingegeben, bestätigt oder korrigiert (neueste zuerst). */
export function StocktakeLogCard({ events, total }: { events: EventView[]; total: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, PREVIEW);
  return (
    <Card flush>
      <CardHeader>
        <CardTitle>Protokoll</CardTitle>
        <CardDescription>
          Jede Eingabe mit Person und Uhrzeit. Einträge lassen sich nicht ändern oder löschen.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {events.length === 0 ? (
          <p className="flex items-center gap-2 px-4 pb-4 text-sm text-muted-foreground sm:px-[18px]">
            <History className="h-4 w-4" aria-hidden />
            Noch keine Einträge.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {shown.map((e) => {
              const badge = TYPE_BADGE[e.type];
              return (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-3 sm:px-[18px]">
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:w-32">{dateTime(e.createdAt)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground [overflow-wrap:anywhere]">
                      {badge && <Badge variant={badge.variant} className="mr-1.5 align-middle">{badge.label}</Badge>}
                      {describeEvent(e)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.actor}
                      {e.via !== "app" && ` · ${VIA_LABEL[e.via] ?? e.via}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(events.length > PREVIEW || total > events.length) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-[18px]">
            <span className="text-xs text-muted-foreground">
              {all ? events.length : Math.min(PREVIEW, events.length)} von {total} Einträgen
              {total > events.length && all && " (vollständig im PDF)"}
            </span>
            {events.length > PREVIEW && (
              <Button type="button" variant="ghost" onClick={() => setAll((v) => !v)} className="h-11 sm:h-9">
                {all ? "Weniger zeigen" : "Alle zeigen"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
