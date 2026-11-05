"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import { formatDuration } from "./labels";
import type { LiveBroadcast, LiveZone } from "./use-live-broadcast";

/** Was eine Zielzone gerade mit der Live-Durchsage macht. */
function zoneState(zone: LiveZone): { label: string; tone: StatusTone; pulse?: boolean } {
  if (!zone.hasDevice) return { label: "kein Abspieler", tone: "neutral" };
  switch (zone.status) {
    case "PLAYING":
      return { label: "live", tone: "success", pulse: true };
    case "DONE":
      return { label: "beendet", tone: "neutral" };
    case "FAILED":
      return { label: "Fehler", tone: "danger" };
    default:
      return zone.deviceOnline
        ? { label: "verbindet …", tone: "warning", pulse: true }
        : { label: "Abspieler offline", tone: "danger" };
  }
}

/**
 * Laufende Live-Durchsage: Dauer, Mikrofonpegel, Stand je Zone und der
 * Stopp-Knopf. Der Pegel ist die einzige Rückmeldung, dass das Mikrofon
 * wirklich etwas hört – ohne ihn spräche man womöglich ins Leere.
 */
export function LiveBroadcastCard({ live }: { live: LiveBroadcast }) {
  const connected = live.zones.some((zone) => zone.status === "PLAYING");
  const failed = live.zones.filter((zone) => zone.status === "FAILED" && zone.errorMessage);

  return (
    // Live ist Smaragd im Zustandsvokabular; Rot bleibt Störungen vorbehalten.
    <Card className="border-success/40 bg-gradient-to-br from-success/14 to-success/[0.03]">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <StatusDot tone="success" size="md" pulse={live.phase === "live"} />
            <span className="font-semibold text-success">
              {live.phase === "starting"
                ? "Live-Durchsage startet …"
                : live.phase === "stopping"
                  ? "Wird beendet …"
                  : "LIVE"}
            </span>
            {live.phase === "live" && (
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {formatDuration(live.seconds)}
              </span>
            )}
          </div>
          <Button
            variant="destructive"
            onClick={() => void live.stop()}
            disabled={live.phase === "stopping"}
            className="h-11 w-full gap-1.5 sm:h-9 sm:w-auto"
          >
            {live.phase === "stopping" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Square className="h-4 w-4 fill-current" />
            )}
            Live-Durchsage beenden
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/10"
            role="meter"
            aria-label="Mikrofonpegel"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(live.level * 100)}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-100",
                live.level > 0.9 ? "bg-destructive" : "bg-success"
              )}
              style={{ width: `${Math.round(live.level * 100)}%` }}
            />
          </div>
        </div>

        {live.zones.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {live.zones.map((zone) => {
              const state = zoneState(zone);
              return (
                <span
                  key={zone.id}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-glass-tile px-3 text-xs ring-1 ring-inset ring-glass-border"
                >
                  <StatusDot tone={state.tone} pulse={state.pulse} size="xs" />
                  <span className="font-medium">{zone.name}</span>
                  <span className="text-muted-foreground">{state.label}</span>
                </span>
              );
            })}
          </div>
        )}

        {failed.map((zone) => (
          <p key={zone.id} className="text-xs text-destructive">
            {zone.name}: {zone.errorMessage}
          </p>
        ))}

        <p className="text-xs text-muted-foreground">
          {live.phase === "live" && !connected
            ? "Die Zonen holen die Durchsage ab – das dauert bis zu 10 Sekunden. Sprich los, sobald sie „live“ zeigen."
            : "Was du sagst, ist mit 1–2 Sekunden Verzögerung zu hören. Nicht direkt neben einem Lautsprecher der Zielzonen sprechen, sonst hallt es zurück."}
        </p>
      </CardContent>
    </Card>
  );
}

/** Schmale Leiste, solange man während einer Live-Durchsage in anderen Tabs ist. */
export function LiveBroadcastBanner({
  live,
  onShow,
}: {
  live: LiveBroadcast;
  onShow: () => void;
}) {
  return (
    // Hinweis-Kachel in Live-Grün. Die Dauer tickt jede Sekunde und ist
    // aria-hidden, damit die Statusregion des Hinweises sie nicht ständig vorliest.
    <Notice
      tone="success"
      compact
      icon={null}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <StatusDot tone="success" pulse={live.phase === "live"} />
          <button type="button" onClick={onShow} className="min-h-11 text-sm font-medium text-success sm:min-h-0">
            Live-Durchsage läuft
          </button>
          {live.phase === "live" && (
            <span aria-hidden className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
              {formatDuration(live.seconds)}
            </span>
          )}
        </span>
      }
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void live.stop()}
          disabled={live.phase === "stopping"}
          className="h-11 gap-1.5 border-destructive/50 text-destructive hover:text-destructive sm:h-8"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
          Beenden
        </Button>
      }
    />
  );
}
