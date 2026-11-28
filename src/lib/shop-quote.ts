import { parseStoredDiscount, type OfferDiscount } from "./shop-scan";

/**
 * Angebot erstellen im Shop-Monitor (28.11.2026, Aaron: „die Angebot erstellen
 * Funktion. Es wird im System erstellt, und PDF wird gedruckt“).
 *
 * Der Kiosk schickt nur Varianten, Mengen, den Rabatt so, wie er am Monitor
 * steht, optional Name und E-Mail und die Summe vom Bildschirm. Preise rechnet
 * der EMP-Shop (`POST /api/v1/quotes`); weicht seine Summe ab, entsteht kein
 * Angebot. Kunde ist der Kunde zur E-Mail, wenn der Shop genau einen kennt,
 * sonst der Laufkunde (Aaron: „Laufkunde, Name optional“).
 */

export const SHOP_QUOTE_MAX_ITEMS = 100;
export const SHOP_QUOTE_MAX_QUANTITY = 999;
export const SHOP_QUOTE_NAME_MAX = 100;
export const SHOP_QUOTE_EMAIL_MAX = 200;

const VARIANT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_KEY = /^[A-Za-z0-9-]{8,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ShopQuoteRequest {
  items: Array<{ variantId: string; quantity: number }>;
  discount: OfferDiscount | null;
  customer: { name: string | null; email: string | null };
  /** Summe inkl. MwSt. nach Rabatt, wie der Monitor sie zeigt */
  expectedTotalCents: number;
  /** Je Versuch derselbe Schlüssel: eine Wiederholung legt kein zweites Angebot an */
  requestKey: string;
}

/** 156303 → „1563.03“; Basispunkte ergeben so auch Prozent („1000“ → „10.00“). */
export function centsText(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const rest = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${whole}.${rest}`;
}

/** Ist die E-Mail-Adresse brauchbar? Leer ist erlaubt (Laufkunde). */
export function isShopQuoteEmail(email: string): boolean {
  return email.length <= SHOP_QUOTE_EMAIL_MAX && EMAIL.test(email);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
}

/** Body vom Kiosk prüfen; dieselbe Variante zweimal wird eine Position. */
export function parseShopQuoteRequest(body: unknown): { ok: true; value: ShopQuoteRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Ungültige Anfrage." };
  const b = body as Record<string, unknown>;
  if (typeof b.requestKey !== "string" || !REQUEST_KEY.test(b.requestKey)) return { ok: false, error: "Ungültige Anfrage. Bitte die Seite neu laden." };
  const rawItems: unknown[] = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length === 0) return { ok: false, error: "Das Angebot hat keine Positionen." };
  if (rawItems.length > SHOP_QUOTE_MAX_ITEMS) return { ok: false, error: `Höchstens ${SHOP_QUOTE_MAX_ITEMS} Positionen in einem Angebot.` };
  const quantities = new Map<string, number>();
  for (const raw of rawItems) {
    const item = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const quantity = item.quantity;
    if (typeof item.variantId !== "string" || !VARIANT_ID.test(item.variantId)) return { ok: false, error: "Ungültige Positionen." };
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > SHOP_QUOTE_MAX_QUANTITY) return { ok: false, error: "Ungültige Menge." };
    quantities.set(item.variantId, Math.min(SHOP_QUOTE_MAX_QUANTITY, (quantities.get(item.variantId) ?? 0) + quantity));
  }
  const discount = b.discount === null || b.discount === undefined ? null : parseStoredDiscount(JSON.stringify(b.discount));
  if (b.discount && !discount) return { ok: false, error: "Ungültiger Rabatt." };
  const customerRaw = (typeof b.customer === "object" && b.customer !== null ? b.customer : {}) as Record<string, unknown>;
  const name = cleanText(customerRaw.name, SHOP_QUOTE_NAME_MAX);
  const email = cleanText(customerRaw.email, SHOP_QUOTE_EMAIL_MAX)?.toLowerCase() ?? null;
  if (email && !isShopQuoteEmail(email)) return { ok: false, error: "Die E-Mail-Adresse ist nicht gültig." };
  const expected = b.expectedTotalCents;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0 || expected > 9_999_999_99) return { ok: false, error: "Ungültige Summe." };
  return {
    ok: true,
    value: {
      items: [...quantities.entries()].map(([variantId, quantity]) => ({ variantId, quantity })),
      discount,
      customer: { name, email },
      expectedTotalCents: expected,
      requestKey: b.requestKey,
    },
  };
}

/** Body für `POST /api/v1/quotes` im EMP-Shop; Beträge als Text, nie als Gleitkommazahl. */
export function empShopQuoteBody(request: ShopQuoteRequest, source: string): Record<string, unknown> {
  const d = request.discount;
  return {
    items: request.items,
    ...(d ? { discount: d.kind === "percent" ? { percent: centsText(d.basisPoints) } : d.kind === "amount" ? { amount: centsText(d.cents) } : { total: centsText(d.cents) } } : {}),
    customer: { name: request.customer.name, email: request.customer.email },
    expectedGrossTotal: centsText(request.expectedTotalCents),
    print: true,
    source: source.slice(0, 80),
  };
}

/** Antwort des Kiosks nach dem Anlegen, ohne Kennungen oder Schlüssel des Shops. */
export interface ShopQuoteView {
  number: string;
  grossTotalCents: number;
  validUntil: string;
  customerName: string;
  customerNumber: string;
  matched: boolean;
  print: "PRINTNODE" | "BROWSER" | "NONE";
  printerName: string | null;
  printMessage: string | null;
}
