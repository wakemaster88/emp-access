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

/** Kamera: Derselbe Code zählt erst wieder, wenn er so lange nicht mehr im Bild war. */
export const CAMERA_SAME_CODE_GAP_MS = 1500;

/** Kamera geht nach so langer Zeit ohne erkannten Code von selbst aus. */
export const CAMERA_IDLE_OFF_MS = 60_000;

/**
 * Soll ein Code, den die Kamera gerade sieht, als Scan zählen? Ein Etikett, das
 * vor der Kamera liegen bleibt, zählt nur einmal: Jeder Treffer verlängert die
 * Sperre, erst nach `CAMERA_SAME_CODE_GAP_MS` ohne diesen Code zählt er wieder.
 */
export function cameraCodeGate(
  last: { code: string; at: number } | null,
  code: string,
  now: number,
): { report: boolean; last: { code: string; at: number } } {
  const report = !last || last.code !== code || now - last.at >= CAMERA_SAME_CODE_GAP_MS;
  return { report, last: { code, at: now } };
}

/**
 * Kamerabild spiegeln wie ein Spiegel, wenn die Kamera zum Personal schaut
 * (Frontkamera, Laptop-Kamera ohne Angabe): Dann führt man das Etikett in die
 * richtige Richtung. Die Rückkamera bleibt ungespiegelt.
 */
export function mirrorCameraPreview(facingMode: string | undefined, finePointer: boolean): boolean {
  if (facingMode === "environment") return false;
  if (facingMode === "user") return true;
  return finePointer;
}

/**
 * Rabatt auf das ganze Angebot (28.11.2026, Aaron: „noch einen Rabatt eingeben
 * können“): in Prozent, als Betrag oder als gewünschter Endpreis. Gerechnet
 * wird in Cent auf die Summe der Positionen mit Preis.
 */
export type OfferDiscount =
  /** 1000 = 10 % */
  | { kind: "percent"; basisPoints: number }
  /** Betrag, der abgezogen wird */
  | { kind: "amount"; cents: number }
  /** Endpreis, den der Kunde zahlt */
  | { kind: "total"; cents: number };

/** Eingabe wie „12,5“ oder „1.086,90 €“ in Cent; Unlesbares ist null. */
export function centsFromInput(text: string): number | null {
  let t = text.replace(/[\s€]/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "");
  return centsFromAmount(t.replace(",", "."));
}

/** Eingabe aus dem Rabattfeld prüfen: Prozent über 0 bis 100, Beträge ab 0,01 €. */
export function parseDiscountInput(kind: OfferDiscount["kind"], text: string): OfferDiscount | null {
  const cents = centsFromInput(text.replace(/%/g, ""));
  if (cents === null || cents <= 0) return null;
  if (kind === "percent") return cents <= 10_000 ? { kind, basisPoints: cents } : null;
  return { kind, cents };
}

/**
 * Rabatt auf die Summe: kaufmännisch gerundet, nie mehr als die Summe und nie
 * ein Aufschlag (ein Endpreis über der Summe gibt keinen Rabatt).
 */
export function applyOfferDiscount(totalCents: number, discount: OfferDiscount | null): { discountCents: number; finalCents: number } {
  let discountCents = 0;
  if (discount?.kind === "percent") discountCents = Math.round((totalCents * discount.basisPoints) / 10_000);
  else if (discount?.kind === "amount") discountCents = discount.cents;
  else if (discount?.kind === "total") discountCents = totalCents - discount.cents;
  discountCents = Math.min(Math.max(0, discountCents), Math.max(0, totalCents));
  return { discountCents, finalCents: totalCents - discountCents };
}

/** Prozent mit höchstens einer Nachkommastelle, wie „10 %“ oder „12,5 %“. */
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "0 %";
  const tenth = Math.round((part * 1000) / whole) / 10;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(tenth)} %`;
}

/** Gespeicherten Rabatt (localStorage) prüfen; Unlesbares ist kein Rabatt. */
export function parseStoredDiscount(raw: string | null): OfferDiscount | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<{ kind: string; basisPoints: number; cents: number }>;
    if (d.kind === "percent" && Number.isInteger(d.basisPoints) && d.basisPoints! > 0 && d.basisPoints! <= 10_000) return { kind: "percent", basisPoints: d.basisPoints! };
    if ((d.kind === "amount" || d.kind === "total") && Number.isInteger(d.cents) && d.cents! > 0) return { kind: d.kind, cents: d.cents! };
    return null;
  } catch {
    return null;
  }
}
