/**
 * Bild zum Scan (HubTask SCAN_SNAPSHOT): Den Auftrag holt der Hub vor Ort ab.
 * Hat sich in den letzten 5 Minuten kein Hub des Accounts gemeldet
 * (`HubAgent.lastSeenAt`), legt der Pi-Scan keinen Auftrag an.
 *
 * Ob ein Hub da ist, steht je (Instanz, Account) 60 s im Speicher (wie die
 * Einlass-Regeln in access-rules-cache.ts). Gefragt wird erst nach der
 * Antwort ans Drehkreuz und nur für Geräte mit Kamera. Kann die Abfrage nicht
 * laufen, wird der Auftrag angelegt wie bisher.
 */
import { createTtlCache } from "./ttl-cache";

/** So lange darf die letzte Meldung eines Hubs zurückliegen. */
export const SNAPSHOT_HUB_SEEN_WITHIN_MS = 5 * 60_000;
const HUB_SEEN_TTL_MS = 60_000;

type HubSeenDb = {
  hubAgent: {
    findFirst: (args: {
      where: { accountId: number; lastSeenAt: { not: null } };
      orderBy: { lastSeenAt: "desc" };
      select: { lastSeenAt: true };
    }) => Promise<{ lastSeenAt: Date | null } | null>;
  };
};

const cache = createTtlCache<boolean>(HUB_SEEN_TTL_MS, { maxEntries: 100 });

/** Hat sich ein Hub innerhalb von 5 Minuten vor `now` gemeldet? */
export function hubSeenRecently(lastSeenAt: Date | null | undefined, now: number): boolean {
  return lastSeenAt != null && now - lastSeenAt.getTime() <= SNAPSHOT_HUB_SEEN_WITHIN_MS;
}

/** Bild-Auftrag anlegen? Ja, wenn ein Hub des Accounts kürzlich da war oder die Abfrage scheitert. */
export async function shouldQueueScanSnapshot(
  db: HubSeenDb,
  accountId: number,
  now: () => number = Date.now,
): Promise<boolean> {
  try {
    return await cache.get(String(accountId), async () => {
      const hub = await db.hubAgent.findFirst({
        where: { accountId, lastSeenAt: { not: null } },
        orderBy: { lastSeenAt: "desc" },
        select: { lastSeenAt: true },
      });
      return hubSeenRecently(hub?.lastSeenAt, now());
    });
  } catch (err) {
    console.error("[scan] hub lookup for snapshot failed:", err);
    return true;
  }
}

/** Für Tests. */
export function clearScanSnapshotHubCache() {
  cache.clear();
}
