"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Popup auf dem Kassen-Monitor, wenn am Drehkreuz jemand ohne gueltigen Scan
 * durchgegangen ist.
 *
 * Bewusst aufdringlich: Der Bildschirm steht im Verkauf, dort schaut niemand
 * dauerhaft hin. Ein Banner am Rand wuerde untergehen — und der Hinweis ist
 * nur etwas wert, solange die Person noch in der Naehe ist. Weg geht es erst
 * per Klick, damit es nicht unbemerkt verschwindet, waehrend jemand kassiert.
 */

const POLL_MS = 4000;

interface Alert {
  id: number;
  kind: string;
  message: string;
  source: string | null;
  occurredAt: string;
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-lg rounded-2xl border-2 border-red-500/70 bg-slate-900 p-6 shadow-2xl shadow-red-950/50">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-red-500/15 p-3">
            <AlertTriangle className="h-8 w-8 animate-pulse text-red-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-red-100">
              Durchgang ohne gültigen Scan
            </h2>
            <p className="mt-2 text-slate-200">{current.message}</p>
            <p className="mt-2 text-sm text-slate-400">
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
        <button
          type="button"
          onClick={() => void acknowledge()}
          disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 font-semibold text-white transition-colors hover:bg-red-500 active:scale-[0.99] disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Verstanden
        </button>
      </div>
    </div>
  );
}
