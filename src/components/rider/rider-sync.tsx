"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RIDER_STALE_ON_FOCUS_MS, RIDER_STALE_ON_OPEN_MS, riderNeedsSync } from "@/lib/rider-local";

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
    const sync = (maxAge: number) => {
      if (!navigator.onLine || !riderNeedsSync(lastSync.current, Date.now(), maxAge)) return;
      lastSync.current = Date.now();
      router.refresh();
    };
    sync(RIDER_STALE_ON_OPEN_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync(RIDER_STALE_ON_FOCUS_MS);
    };
    const onOnline = () => sync(0);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [router]);

  return null;
}
