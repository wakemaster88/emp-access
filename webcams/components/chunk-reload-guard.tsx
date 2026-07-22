"use client";

import { useEffect } from "react";

const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

const GUARD_KEY = "chunk-reload-ts";
// Mindestabstand zwischen automatischen Reloads, damit ein dauerhaft kaputter
// Build keine Endlos-Reload-Schleife erzeugt.
const MIN_RELOAD_GAP_MS = 10_000;

/**
 * Lädt die Seite nach einem Deploy einmalig hart neu, wenn ein bereits offener
 * Tab (z.B. der Kiosk-Bildschirm) noch auf alte JS-Chunks verweist, die der
 * neue Build nicht mehr enthält. Ohne das schlägt eine Client-Navigation (etwa
 * der Klick auf „Admin") nach einem Rebuild fehl.
 */
export function ChunkReloadGuard() {
  useEffect(() => {
    const reloadOnce = () => {
      try {
        const last = Number(sessionStorage.getItem(GUARD_KEY) ?? "0");
        if (Date.now() - last < MIN_RELOAD_GAP_MS) return;
        sessionStorage.setItem(GUARD_KEY, String(Date.now()));
      } catch {
        /* sessionStorage evtl. blockiert – dann reloaden wir trotzdem */
      }
      window.location.reload();
    };

    const onError = (e: ErrorEvent) => {
      const msg = e?.message || e?.error?.message || "";
      if (CHUNK_ERROR_RE.test(msg)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e?.reason;
      const msg =
        typeof reason === "string" ? reason : reason?.message || reason?.name || "";
      if (CHUNK_ERROR_RE.test(msg)) reloadOnce();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
