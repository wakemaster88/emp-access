"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RIDER_STALE_ON_FOCUS_MS, RIDER_STALE_ON_OPEN_MS, riderNeedsSync } from "@/lib/rider-local";

/** So lange wartet die Prüfung auf eine Antwort des Servers. */
const REACH_TIMEOUT_MS = 4_000;
/** Antwortet der Server nicht, frühestens nach dieser Zeit erneut versuchen. */
const RIDER_SYNC_RETRY_MS = 30_000;

/** Zeitpunkt des letzten router.refresh() in diesem Tab (sessionStorage). */
const REFRESH_STAMP_KEY = "emp-rider-refresh-at";

function readRefreshStamp(): number {
  try {
    return Number(sessionStorage.getItem(REFRESH_STAMP_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

function writeRefreshStamp(ms: number) {
  try {
    sessionStorage.setItem(REFRESH_STAMP_KEY, String(ms));
  } catch {
    // Ohne sessionStorage (Privat-Modus): dann ohne Erkennung gescheiterter Refreshes.
  }
}

/** Antwortet der Server gerade? Kurzer Abruf der Build-ID (ohne Datenbank, nie gecacht). */
async function serverReachable(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REACH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/version", { cache: "no-store", signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hintergrund-Abgleich der Kunden-App. Die Seite kommt oft sofort aus dem
 * lokalen Cache des Service Workers; ist sie älter als ein paar Sekunden,
 * holt diese Komponente still die frischen Serverdaten nach. Dasselbe, wenn
 * die App nach einer Minute wieder in den Vordergrund kommt oder das Netz
 * zurück ist. `renderedAt` setzt der Server bei jedem Rendern neu.
 */
export function RiderSync({ renderedAt }: { renderedAt: number }) {
  const router = useRouter();
  const lastSync = useRef(renderedAt);

  useEffect(() => {
    lastSync.current = renderedAt;
  }, [renderedAt]);

  useEffect(() => {
    let active = true;
    let checking = false;
    let retryAt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // Erst kurz fragen, ob der Server antwortet: sonst lädt Next bei einem
    // gescheiterten Refresh die ganze Seite neu. Ohne Antwort bleibt der
    // angezeigte Stand, der nächste Versuch frühestens nach RIDER_SYNC_RETRY_MS.
    const sync = (maxAge: number) => {
      if (checking || !navigator.onLine || Date.now() < retryAt || !riderNeedsSync(lastSync.current, Date.now(), maxAge)) return;
      checking = true;
      void serverReachable().then((ok) => {
        checking = false;
        if (!active) return;
        if (ok) {
          lastSync.current = Date.now();
          writeRefreshStamp(lastSync.current);
          router.refresh();
          return;
        }
        scheduleRetry(maxAge, RIDER_SYNC_RETRY_MS);
      });
    };
    const scheduleRetry = (maxAge: number, delay: number) => {
      retryAt = Date.now() + delay;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        // Der Timer selbst darf immer: seine Uhr und Date.now() laufen nicht genau gleich.
        retryAt = 0;
        sync(maxAge);
      }, delay);
    };
    // Scheitert ein Refresh am Server (z. B. 504), lädt Next die Seite ganz
    // neu und sie kommt wieder aus dem lokalen Cache. Ist die angezeigte
    // Seite älter als der letzte Refresh, der keine RIDER_SYNC_RETRY_MS her
    // ist, war er erfolglos: dann erst nach der Pause erneut versuchen.
    const stamp = readRefreshStamp();
    const sinceStamp = Date.now() - stamp;
    if (stamp > 0 && sinceStamp >= 0 && sinceStamp < RIDER_SYNC_RETRY_MS && lastSync.current < stamp) {
      scheduleRetry(RIDER_STALE_ON_OPEN_MS, RIDER_SYNC_RETRY_MS - sinceStamp);
    } else {
      sync(RIDER_STALE_ON_OPEN_MS);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") sync(RIDER_STALE_ON_FOCUS_MS);
    };
    const onOnline = () => sync(0);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [router]);

  return null;
}
