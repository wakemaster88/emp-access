/**
 * anny-Webhooks zu Rechnungen und Abos (invoices.*, subscriptions.*).
 *
 * Ziel: Ein Abo mit „Zahlung offen“ (extras.paymentPause, siehe lib/payment-open)
 * soll sofort wieder gelten, wenn anny die Rechnung als bezahlt meldet, nicht
 * erst beim nächsten Abgleich. Alles andere entscheidet weiter der Abgleich.
 *
 * Die Felder der Webhook-Nutzlast sind bei anny nur grob beschrieben; die
 * Auswertung ist deshalb tolerant und protokolliert die Feldnamen.
 */
import type { PrismaClient } from "@prisma/client";

export interface AnnyInvoiceEvent {
  event: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  status: string | null;
  /** id der plan-subscription, wenn die Rechnung zu einem Abo gehört. */
  subscriptionId: string | null;
}

const PAID = new Set(["paid", "settled", "completed", "succeeded"]);

export function isAnnyPaymentEvent(event: string): boolean {
  return event.startsWith("invoices.") || event.startsWith("subscriptions.");
}

export function isPaidInvoiceStatus(status: string | null): boolean {
  return !!status && PAID.has(status.toLowerCase());
}

const idStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

function isSubscriptionType(v: unknown): boolean {
  return typeof v === "string" && /subscription/i.test(v);
}

/** Liest eine Rechnung aus der Nutzlast (flach, JSON:API oder mit `invoice`-Hülle). */
export function parseAnnyInvoiceEvent(event: string, data: unknown): AnnyInvoiceEvent | null {
  if (!event.startsWith("invoices.") || !data || typeof data !== "object") return null;
  let d = data as Record<string, unknown>;
  if (d.invoice && typeof d.invoice === "object") d = d.invoice as Record<string, unknown>;
  const attrs = (d.attributes && typeof d.attributes === "object" ? d.attributes : d) as Record<string, unknown>;

  let subscriptionId: string | null = null;
  // flach: reference { id, type } oder reference_id + reference_type
  const ref = (attrs.reference ?? d.reference) as Record<string, unknown> | undefined;
  if (ref && typeof ref === "object") {
    const inner = (ref.data && typeof ref.data === "object" ? ref.data : ref) as Record<string, unknown>;
    if (isSubscriptionType(inner.type) || isSubscriptionType(inner.object)) subscriptionId = idStr(inner.id);
  }
  if (!subscriptionId && isSubscriptionType(attrs.reference_type)) subscriptionId = idStr(attrs.reference_id);
  // JSON:API: relationships.reference.data
  const rel = (d.relationships as Record<string, unknown> | undefined)?.reference as Record<string, unknown> | undefined;
  const relData = rel?.data as Record<string, unknown> | undefined;
  if (!subscriptionId && relData && isSubscriptionType(relData.type)) subscriptionId = idStr(relData.id);
  if (!subscriptionId) subscriptionId = idStr(attrs.plan_subscription_id) ?? idStr(attrs.subscription_id);

  return {
    event,
    invoiceId: idStr(d.id),
    invoiceNumber: idStr(attrs.formatted_number) ?? idStr(attrs.number),
    status: typeof attrs.status === "string" ? attrs.status : null,
    subscriptionId,
  };
}

export interface PaymentWebhookResult {
  event: string;
  handled: "resumed" | "still_open" | "no_match" | "not_paid" | "ignored";
  ticketIds: number[];
}

/**
 * Bezahlte Abo-Rechnung: passende Abos mit „Zahlung offen“ wieder freigeben.
 * Treffer über die Rechnungsnummer im Vermerk oder die anny-Abo-id im uuid
 * (`anny-sub:<kunde>:<abo>`). Sind laut Vermerk noch weitere Rechnungen offen,
 * bleibt die Pause; der nächste Abgleich rechnet nach. Das Ablaufdatum bleibt.
 */
export async function applyAnnyPaymentEvent(
  db: PrismaClient,
  accountId: number,
  event: string,
  data: unknown,
): Promise<PaymentWebhookResult> {
  const inv = parseAnnyInvoiceEvent(event, data);
  if (!inv) return { event, handled: "ignored", ticketIds: [] };
  if (!isPaidInvoiceStatus(inv.status)) return { event, handled: "not_paid", ticketIds: [] };

  const or: Array<Record<string, unknown>> = [];
  if (inv.invoiceNumber) or.push({ extras: { path: ["paymentPause", "invoiceNumber"], equals: inv.invoiceNumber } });
  if (inv.subscriptionId) or.push({ uuid: { startsWith: "anny-sub:", endsWith: `:${inv.subscriptionId}` } });
  if (or.length === 0) return { event, handled: "no_match", ticketIds: [] };

  const tickets = await db.ticket.findMany({
    where: { accountId, status: "PAUSED", subscriptionId: { not: null }, OR: or },
    select: { id: true, extras: true, endDate: true },
    take: 20,
  });
  const now = Date.now();
  const resumed: number[] = [];
  let stillOpen = false;
  for (const t of tickets) {
    const extras = (t.extras && typeof t.extras === "object" && !Array.isArray(t.extras) ? t.extras : {}) as Record<string, unknown>;
    const pay = extras.paymentPause as Record<string, unknown> | undefined;
    if (!pay || typeof pay !== "object") continue;
    const openCount = typeof pay.openCount === "number" ? pay.openCount : 1;
    // Weitere offene Rechnungen oder zusätzlich eine anny-Pause: Abgleich entscheidet.
    if (openCount > 1 || extras.pausedAt || (t.endDate && t.endDate.getTime() < now)) {
      stillOpen = true;
      continue;
    }
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extras)) if (k !== "paymentPause") next[k] = v;
    await db.ticket.update({
      where: { id: t.id },
      data: { status: "VALID", extras: next as object },
    });
    resumed.push(t.id);
  }
  if (resumed.length > 0) return { event, handled: "resumed", ticketIds: resumed };
  return { event, handled: stillOpen ? "still_open" : "no_match", ticketIds: [] };
}
