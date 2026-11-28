/**
 * Shop-Scan im Shop-Monitor (28.11.2026): Preisetiketten aus dem EMP-Shop
 * scannen und die Artikel wie ein Angebot zusammenstellen.
 *
 * Die Etiketten tragen als QR-Code den Link `HTTPS://4WAKE.EU/A/<Artikelnummer>`
 * (EMP-Shop, `articleLabelLink`). Den Artikel samt Preis liefert der EMP-Shop
 * (`GET /api/v1/products/lookup`, siehe src/lib/emp-shop-client.ts); hier steht
 * nur, was auch der Browser braucht: Code erkennen und Summen rechnen.
 *
 * Ohne Server-Abhängigkeiten, damit Kiosk-Seite und Route es teilen.
 */

/** Etikett-Link, wie der QR-Code ihn trägt (Groß- und Kleinschreibung egal). */
const LABEL_LINK = /^https?:\/\/(?:www\.)?4wake\.eu\/a\/(.+?)\/?$/i;

/**
 * Derselbe Link von einem Handscanner, der eine US-Tastatur sendet, während
 * der Rechner auf Deutsch steht: „:“ kommt als „Ö“, „/“ als „-“. Dann ist auch
 * die Artikelnummer verdreht und wird zurückübersetzt (`fromUsOnGerman`).
 */
const LABEL_LINK_US_ON_DE = /^https?Ö--(?:www\.)?4wake\.eu-a-(.+?)-?$/i;

/** Tasten, die ein US-Scanner an einer deutschen Tastatur anders tippt: gelesen → gemeint. */
const US_ON_DE: Record<string, string> = {
  "-": "/",
  "ß": "-",
  "?": "_",
  z: "y",
  y: "z",
  Z: "Y",
  Y: "Z",
  "Ö": ":",
  "ö": ";",
};

function fromUsOnGerman(text: string): string {
  return [...text].map((c) => US_ON_DE[c] ?? c).join("");
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Artikelnummer aus einem gescannten Preisetikett, sonst null. Andere Codes
 * (Tickets, Bändchen, EAN) sind kein Etikett.
 */
export function shopLabelCode(raw: string): string | null {
  const text = raw.trim();
  const link = LABEL_LINK.exec(text);
  if (link?.[1]) return decode(link[1]).trim() || null;
  const verdreht = LABEL_LINK_US_ON_DE.exec(text);
  if (verdreht?.[1]) return decode(fromUsOnGerman(verdreht[1])).trim() || null;
  return null;
}

/** Ist der Scan ein Preisetikett des Shops? Dann gehört er in den Shop-Modus. */
export function isShopLabelScan(raw: string): boolean {
  return shopLabelCode(raw) !== null;
}

/**
 * Code, der an den EMP-Shop geht: beim Etikett die Artikelnummer, sonst der
 * Scan selbst (Artikelnummer oder EAN von der Verpackung).
 */
export function shopScanCode(raw: string): string {
  return shopLabelCode(raw) ?? raw.trim();
}

/** Artikel, wie der Shop-Scan ihn anzeigt. */
export interface ShopArticle {
  variantId: string;
  sku: string;
  productNumber: string;
  name: string;
  brand: string | null;
  /** Ausprägungen wie auf dem Etikett, z. B. ["144"] oder ["M", "Black"]. */
  options: string[];
  /** „B-WARE“ oder „MUSTER“, sonst null. */
  conditionBadge: string | null;
  conditionNote: string | null;
  /** Bruttopreis in Cent; null, wenn der Shop keinen Preis hat. */
  priceCents: number | null;
  /** Preis, wie der Shop ihn schreibt („529,95 €“). */
  priceDisplay: string | null;
  /** UVP, nur wenn sie über dem Preis liegt. */
  msrpDisplay: string | null;
  /** „Du sparst 11 %“ wie auf dem Etikett. */
  saving: string | null;
  imageUrl: string | null;
  /** Artikel im Onlineshop freigegeben (ACTIVE). */
  online: boolean;
}

/** Position im Angebot. */
export interface ShopOfferLine {
  article: ShopArticle;
  quantity: number;
}

/** Höchstmenge je Position: schützt vor einem hängenden Scanner. */
export const SHOP_LINE_MAX_QUANTITY = 99;

/**
 * Betrag aus dem Shop („529.95“) in Cent, ohne Gleitkomma. Unlesbares ist null.
 */
export function centsFromAmount(amount: string | null | undefined): number | null {
  if (typeof amount !== "string") return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

/** Betrag in Euro wie im Shop: „1.499,00 €“. */
export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/**
 * Gescannten Artikel ins Angebot: Gibt es ihn schon, eine Position mehr, sonst
 * oben eine neue Zeile. Die Artikeldaten nimmt der neue Scan (Preis frisch).
 */
export function addToOffer(lines: readonly ShopOfferLine[], article: ShopArticle, quantity = 1): ShopOfferLine[] {
  const index = lines.findIndex((l) => l.article.variantId === article.variantId);
  if (index < 0) return [{ article, quantity: Math.min(Math.max(1, quantity), SHOP_LINE_MAX_QUANTITY) }, ...lines];
  return lines.map((l, i) =>
    i === index ? { article, quantity: Math.min(l.quantity + Math.max(1, quantity), SHOP_LINE_MAX_QUANTITY) } : l,
  );
}

/** Menge einer Position setzen; 0 oder weniger entfernt sie. */
export function setOfferQuantity(lines: readonly ShopOfferLine[], variantId: string, quantity: number): ShopOfferLine[] {
  if (quantity <= 0) return lines.filter((l) => l.article.variantId !== variantId);
  const q = Math.min(Math.floor(quantity), SHOP_LINE_MAX_QUANTITY);
  return lines.map((l) => (l.article.variantId === variantId ? { ...l, quantity: q } : l));
}

/** Summe des Angebots in Cent; Positionen ohne Preis zählen als offen. */
export function offerTotals(lines: readonly ShopOfferLine[]): { pieces: number; totalCents: number; withoutPrice: number } {
  let pieces = 0;
  let totalCents = 0;
  let withoutPrice = 0;
  for (const l of lines) {
    pieces += l.quantity;
    if (l.article.priceCents === null) withoutPrice += 1;
    else totalCents += l.article.priceCents * l.quantity;
  }
  return { pieces, totalCents, withoutPrice };
}

/** Gespeichertes Angebot (localStorage) prüfen; Unlesbares wird verworfen. */
export function parseStoredOffer(raw: string | null): ShopOfferLine[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (l): l is ShopOfferLine =>
        !!l &&
        typeof l === "object" &&
        typeof (l as ShopOfferLine).quantity === "number" &&
        (l as ShopOfferLine).quantity > 0 &&
        typeof (l as ShopOfferLine).article?.variantId === "string" &&
        typeof (l as ShopOfferLine).article?.name === "string",
    );
  } catch {
    return [];
  }
}
