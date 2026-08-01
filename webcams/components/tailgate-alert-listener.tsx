"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, VolumeX, X } from "lucide-react";
import { subscribeTailgatePass, type TailgatePass } from "./use-tailgate-alerts";
import { armAudioUnlock, audioBlocked, playTailgateTone } from "./alert-sound";

/**
 * Meldet im Kontrollzentrum, wenn jemand ohne gültigen Scan durchgegangen ist.
 *
 * Bewusst ein Streifen oben statt eines Overlays über dem ganzen Bild: Wer
 * hier sitzt, will genau jetzt auf die Kameras schauen können — eine Fläche,
 * die die Sicht nimmt, wäre im Ernstfall das Gegenteil von hilfreich.
 */

/** Wie lange der Streifen stehen bleibt, wenn ihn niemand wegklickt. */
const AUTO_HIDE_MS = 25_000;

export function TailgateAlertListener() {
  const [alert, setAlert] = useState<TailgatePass | null>(null);
  const [muted, setMuted] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => armAudioUnlock(), []);

  useEffect(() => {
    return subscribeTailgatePass((ev) => {
      playTailgateTone();
      setMuted(audioBlocked());
      setAlert(ev);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setAlert(null), AUTO_HIDE_MS);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!alert) return null;

  const zeit = new Date(alert.crossedAt).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-red-500/60 bg-red-950/95 px-4 py-3 shadow-lg shadow-red-950/50 ring-1 ring-red-500/20">
        <AlertTriangle className="h-6 w-6 shrink-0 animate-pulse text-red-400" />
        <div className="min-w-0">
          <div className="font-semibold text-red-100">
            {alert.count === 1
              ? "Durchgang ohne gültigen Scan"
              : `${alert.count} Durchgänge ohne gültigen Scan`}
          </div>
          <div className="text-sm text-red-200/80">
            {alert.camName} · {zeit}
          </div>
        </div>
        {muted && (
          <span
            className="flex items-center gap-1 rounded border border-amber-500/40 px-2 py-1 text-xs text-amber-200"
            title="Der Browser lässt Ton erst zu, nachdem die Seite einmal angeklickt wurde."
          >
            <VolumeX className="h-3.5 w-3.5" />
            Ton gesperrt
          </span>
        )}
        <button
          type="button"
          onClick={() => setAlert(null)}
          className="rounded p-1 text-red-200/70 transition-colors hover:bg-red-900/60 hover:text-red-100"
          title="Ausblenden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
