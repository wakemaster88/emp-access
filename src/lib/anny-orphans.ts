/**
 * Aufraeum-Schritt des ANNY-Syncs: welche Tickets duerfen auf ungueltig
 * gesetzt werden, wenn ANNY sie nicht mehr meldet?
 *
 * Der Sync liest zwei Quellen - Buchungen und plan-subscriptions (Abos,
 * Ticket-UUID `anny-sub:...`). Faellt eine davon teilweise aus (HTTP 429/5xx,
 * Timeout, Seitenlimit), fehlen gueltige Eintraege in der Liste der aktiven
 * UUIDs. Aufgeraeumt wird deshalb nur der Teil, dessen Quelle vollstaendig
 * gelesen wurde.
 */
export type AnnyIncomplete = { bookings: string[]; subscriptions: string[] };

export const SUBSCRIPTION_UUID_PREFIX = "anny-sub:";

export function newAnnyIncomplete(): AnnyIncomplete {
  return { bookings: [], subscriptions: [] };
}

/**
 * Prisma-Filter fuer die aufzuraeumenden Tickets, oder null, wenn gar nicht
 * aufgeraeumt werden darf.
 */
export function orphanCleanupScope(incomplete: AnnyIncomplete, syncCutoff: Date) {
  const bookingsOk = incomplete.bookings.length === 0;
  const subscriptionsOk = incomplete.subscriptions.length === 0;
  const isSubscription = { uuid: { startsWith: SUBSCRIPTION_UUID_PREFIX } };

  if (bookingsOk && subscriptionsOk) {
    return { OR: [{ startDate: { gte: syncCutoff } }, isSubscription] };
  }
  if (bookingsOk) {
    // Nur Buchungs-Tickets im Sync-Fenster; Abo-Tickets bleiben unangetastet.
    return { startDate: { gte: syncCutoff }, NOT: isSubscription };
  }
  if (subscriptionsOk) {
    return isSubscription;
  }
  return null;
}
