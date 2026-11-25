/**
 * Abgleich der Raumdaten mit der Cloud (rooms.ts): Zeitpunkt eines Stands
 * aus dem Platten-Cache. Reine Logik.
 */

/**
 * Zeitpunkt eines Stands aus dem Platten-Cache: der beim Abruf vermerkte
 * (syncedAt), bei einem aelteren Cache der Zeitpunkt der Cloud-Antwort (at).
 * null, wenn keiner lesbar ist; dann gilt der Stand als veraltet.
 */
export function cacheSyncedAt(data: { syncedAt?: unknown; at?: unknown }): string | null {
  for (const v of [data.syncedAt, data.at]) {
    if (typeof v === "string" && Number.isFinite(Date.parse(v))) return v;
  }
  return null;
}
