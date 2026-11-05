"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { overlayScrimClass, overlaySheetClass } from "./checkin-ui";

/**
 * Popup auf dem Kassen-Monitor, wenn am Drehkreuz jemand ohne gueltigen Scan
 * durchgegangen ist.
 *
 * Bewusst aufdringlich: Der Bildschirm steht im Verkauf, dort schaut niemand
 * dauerhaft hin. Ein Banner am Rand wuerde untergehen — und der Hinweis ist
 * nur etwas wert, solange die Person noch in der Naehe ist. Weg geht es erst
 * per Klick, damit es nicht unbemerkt verschwindet, waehrend jemand kassiert.
 */

const POLL_MS = 6000;

interface AlertImage {
  position: number;
  label: string | null;
}

interface Alert {
  id: number;
  kind: string;
  message: string;
  source: string | null;
  occurredAt: string;
  images?: AlertImage[];
}

export function TailgateAlertPopup({ token }: { token: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch(`/api/checkin/public/${token}/alerts`, {
          cache: "no-store",
        });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { alerts?: Alert[] };
        if (alive && Array.isArray(data.alerts)) setAlerts(data.alerts);
      } catch {
        /* Netzwerkaussetzer: beim naechsten Durchlauf erneut */
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);

  const current = alerts[0] ?? null;

  const acknowledge = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/checkin/public/${token}/alerts/${current.id}/ack`, {
        method: "POST",
      });
      // Sofort ausblenden statt auf den naechsten Poll zu warten.
      setAlerts((prev) => prev.filter((a) => a.id !== current.id));
    } catch {
      /* bleibt stehen, naechster Versuch per Klick */
    } finally {
      setBusy(false);
    }
  }, [current, busy, token]);

  if (!current) return null;

  const zeit = new Date(current.occurredAt).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const weitere = alerts.length - 1;
  const bilder = current.images ?? [];

  return (
    // Deckende Ebene mit rotem Rand (Störung = destructive); das Symbol pulsiert
    // als Alarm, bei reduzierter Bewegung nicht.
    <div className={cn("fixed inset-0 z-[100] flex items-center justify-center p-6", overlayScrimClass)}>
      <div
        className={cn(
          overlaySheetClass,
          "rounded-card border-2 border-destructive/70 w-full max-h-[calc(100dvh-3rem)] overflow-y-auto p-6",
          bilder.length > 1 ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="flex items-start gap-4">
          <div className="rounded-tile bg-destructive/15 p-3">
            <AlertTriangle className="h-8 w-8 animate-pulse motion-reduce:animate-none text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-foreground">
              Durchgang ohne gültigen Scan
            </h2>
            <p className="mt-2 text-foreground">{current.message}</p>
            <p className="mt-2 text-sm text-muted-foreground tabular-nums">
              {zeit}
              {current.source ? ` · ${current.source}` : ""}
              {weitere > 0
                ? ` · ${weitere} weitere${weitere === 1 ? "r" : ""} Hinweis${
                    weitere === 1 ? "" : "e"
                  } dahinter`
                : ""}
            </p>
          </div>
        </div>
        {bilder.length > 0 && (
          <div
            className={`mt-5 grid gap-3 ${bilder.length > 1 ? "sm:grid-cols-2" : ""}`}
          >
            {bilder.map((bild) => (
              <figure
                key={bild.position}
                className="overflow-hidden rounded-tile border border-border bg-black"
              >
                {/* object-contain statt cover: lieber Rand als ein
                    abgeschnittener Kopf — genau darauf schaut man hier. */}
                <img
                  src={`/api/checkin/public/${token}/alerts/${current.id}/image?i=${bild.position}`}
                  alt=""
                  className="max-h-64 w-full object-contain"
                />
                {bild.label && (
                  <figcaption className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                    {bild.label}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        )}
        <Button
          type="button"
          variant="destructive"
          onClick={() => void acknowledge()}
          disabled={busy}
          className="mt-6 h-14 w-full text-base font-semibold"
        >
          {busy && <Loader2 className="animate-spin" />}
          Verstanden
        </Button>
      </div>
    </div>
  );
}
