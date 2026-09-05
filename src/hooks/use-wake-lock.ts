"use client";

import { useEffect } from "react";

/**
 * Haelt den Bildschirm wach, solange die Seite sichtbar ist – fuer Kiosk,
 * Scan-Monitor und Scanner, die sonst nach ein paar Minuten dunkel werden.
 * iOS 16.4+, Android und Desktop-Chrome koennen das; wo nicht, passiert
 * einfach nichts. Nach dem Zurueckkommen in den Vordergrund wird die Sperre
 * neu angefordert, weil das System sie beim Verlassen freigibt.
 */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let disposed = false;

    const request = async () => {
      if (disposed || document.visibilityState !== "visible" || lock) return;
      try {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => {
          lock = null;
        });
      } catch {
        // z. B. Energiesparmodus oder fehlende Berechtigung – kein Drama.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release().catch(() => {});
      lock = null;
    };
  }, [enabled]);
}
