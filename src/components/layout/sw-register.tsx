"use client";

import { useEffect } from "react";

/**
 * Registriert den Service Worker (Offline-Fallback, Asset-Cache, Web-Push).
 * Global im Root-Layout, damit auch Kiosk, Monitore, Scanner und die
 * Mitarbeiter-PWA installierbar sind und offline eine eigene Seite zeigen.
 *
 * `updateViaCache: "none"` holt sw.js immer frisch vom Server; zusaetzlich
 * wird beim Zurueckkehren in den Vordergrund nach einem Update gesucht, weil
 * Kiosk-iPads tage- bis wochenlang dieselbe Seite offen haben.
 */
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | null = null;

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
      })
      .catch(() => {
        // Registrierung schlaegt z. B. in Privat-Tabs fehl – Push und Offline-
        // Seite sind dann schlicht nicht verfuegbar, der Rest laeuft normal.
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
