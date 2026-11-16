/**
 * Lokaler Stand der Kunden-App (Ride Pass).
 *
 * Der Service Worker (public/sw.js) hält die Seiten angemeldeter Fahrer im
 * Cache `emp-rider-<Version>` vor, damit die App sofort öffnet und auch ohne
 * Netz den letzten Stand zeigt. Der Server bleibt führend: jede Seite holt
 * danach im Hintergrund frische Daten (rider-sync.tsx).
 */

/** Muss zum Cache-Namen `RIDER_CACHE` in public/sw.js passen. */
export const RIDER_CACHE_PREFIX = "emp-rider-";

/** Ist die angezeigte Seite älter als das, holt die App beim Öffnen sofort frische Daten. */
export const RIDER_STALE_ON_OPEN_MS = 15_000;
/** Kommt die App zurück in den Vordergrund, wird ab diesem Alter neu geladen. */
export const RIDER_STALE_ON_FOCUS_MS = 60_000;

/** Soll die App jetzt frische Daten vom Server holen? */
export function riderNeedsSync(lastSyncMs: number, nowMs: number, maxAgeMs: number): boolean {
  if (!Number.isFinite(lastSyncMs) || lastSyncMs <= 0) return true;
  // Uhr des Geräts geht anders als die des Servers: dann lieber einmal mehr laden.
  if (lastSyncMs > nowMs + maxAgeMs) return true;
  return nowMs - lastSyncMs > maxAgeMs;
}

/** Alle lokal gespeicherten Seiten der Kunden-App löschen (beim Abmelden). */
export async function clearRiderLocalData(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(RIDER_CACHE_PREFIX)).map((k) => caches.delete(k)));
  } catch {
    // Privat-Tabs ohne Cache-API: dann gibt es auch nichts zu löschen.
  }
}

/** Zeitstempel für `RiderSync`: wann der Server die Seite gerendert hat. */
export function riderRenderStamp(): number {
  return Date.now();
}
