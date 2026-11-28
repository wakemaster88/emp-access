import { openSecret, sealSecret } from "@/lib/secret-box";

/**
 * Beleg für den Kiosk nach „Angebot erstellen“ (28.11.2026): Mit ihm holt der
 * Monitor das PDF genau dieses Angebots zum Drucken, ohne die Kennung im Shop
 * zu kennen und ohne den API-Schlüssel. Verschlüsselt (`sealSecret`), an
 * Mandant und Monitor gebunden, `SHOP_QUOTE_TICKET_MINUTES` gültig.
 */

export const SHOP_QUOTE_TICKET_MINUTES = 30;
const KIND = "shop-quote";
const QUOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function issueShopQuoteTicket(accountId: number, monitorId: number, quoteId: string, now = new Date()): string {
  const expires = now.getTime() + SHOP_QUOTE_TICKET_MINUTES * 60_000;
  return sealSecret(JSON.stringify({ k: KIND, a: accountId, m: monitorId, q: quoteId, e: expires }));
}

/** Kennung des Angebots im Shop, wenn der Beleg zu Mandant und Monitor passt und nicht abgelaufen ist. */
export function shopQuoteTicketQuoteId(ticket: unknown, accountId: number, monitorId: number, now = new Date()): string | null {
  if (typeof ticket !== "string" || ticket.length > 2_000) return null;
  const plain = openSecret(ticket);
  if (!plain) return null;
  try {
    const d = JSON.parse(plain) as { k?: unknown; a?: unknown; m?: unknown; q?: unknown; e?: unknown };
    if (d.k !== KIND || d.a !== accountId || d.m !== monitorId || typeof d.e !== "number" || d.e <= now.getTime()) return null;
    return typeof d.q === "string" && QUOTE_ID.test(d.q) ? d.q : null;
  } catch {
    return null;
  }
}
