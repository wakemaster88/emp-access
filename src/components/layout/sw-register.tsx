"use client";

import { useEffect } from "react";

/**
 * Registriert den Service Worker der Dashboard-PWA (Web-Push). Wird im
 * Dashboard-Layout eingebunden, damit bestehende Push-Abos auch nach
 * SW-Updates weiterlaufen, ohne dass die Einstellungsseite besucht wird.
 */
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registrierung schlaegt z.B. in Privat-Tabs fehl – Push ist dann
      // schlicht nicht verfuegbar, der Rest der App funktioniert normal.
    });
  }, []);

  return null;
}
