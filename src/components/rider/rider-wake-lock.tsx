"use client";

import { useEffect } from "react";

/**
 * Hält den Bildschirm an, solange ein Code zum Vorzeigen offen ist (Gutschein,
 * Code für die Kasse). Ohne Unterstützung im Browser passiert nichts. Nach dem
 * Zurückkehren in die App holt es die Sperre neu, weil der Browser sie beim
 * Wechsel freigibt.
 */
export function RiderWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock) return;
    let lock: { release(): Promise<void> } | null = null;
    let gone = false;
    const take = () => {
      if (document.visibilityState !== "visible") return;
      nav.wakeLock!
        .request("screen")
        .then((l) => {
          if (gone) void l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {});
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => {});
    };
  }, []);
  return null;
}
