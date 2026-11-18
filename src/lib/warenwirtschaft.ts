/**
 * Warenwirtschaft: reine Hilfsfunktionen für Artikel, Inventuren und das
 * Inventarverzeichnis. Ohne Datenbank, damit sie in Server- und Client-
 * Komponenten und in Tests laufen.
 */

/** Kategorien, die die Oberfläche vorschlägt; frei erweiterbar. */
export const ARTICLE_CATEGORIES = ["Getränke", "Speisen", "Eis", "Shop", "Sonstiges"] as const;

/** Blätter der Inventar-Vorlage, in dieser Reihenfolge. */
export const ASSET_GROUPS = ["Gastronomie", "Strandbad", "Wasserski", "Events", "Büro & Shop", "Übernachtung"] as const;

/** Bildnachweis für Bilder aus Open Food Facts (Lizenz der Produktfotos). */
export const OFF_IMAGE_SOURCE = "Open Food Facts, CC BY-SA 3.0";

/** Euro-Betrag aus Cent, deutsch formatiert („12,50 €“). */
export function formatEuro(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "–";
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/** Menge deutsch, ohne unnötige Nachkommastellen („2“, „0,5“). */
export function formatQty(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return "–";
  return q.toLocaleString("de-DE", { maximumFractionDigits: 3 });
}

/**
 * Eingabe „12,50“, „12.5“ oder „1.234,56“ in Cent. Leer → null,
 * Unsinn → undefined (Aufrufer meldet Fehler).
 */
export function parseEuroToCents(input: string): number | null | undefined {
  const s = input.trim().replace(/\s|€/g, "");
  if (!s) return null;
  const n = parseGermanNumber(s);
  if (n == null || n < 0) return undefined;
  return Math.round(n * 100);
}

/** „1,5“ / „1.5“ / „1.234,5“ → Zahl; leer → null; Unsinn → undefined. */
export function parseGermanNumber(input: string): number | null | undefined {
  let s = input.trim();
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Wert einer Menge zum Einkaufspreis, in Cent (gerundet). */
export function valueCents(qty: number | null | undefined, priceCents: number | null | undefined): number {
  if (qty == null || priceCents == null) return 0;
  return Math.round(qty * priceCents);
}

export interface StocktakeLineLike {
  category: string;
  purchasePriceCents: number | null;
  expected: number;
  counted: number | null;
  broken: number | null;
}

export interface StocktakeTotals {
  lines: number;
  counted: number;
  /** Lagerwert der gezählten Menge. */
  valueCents: number;
  /** Wert des Bruchs. */
  brokenCents: number;
  /** Gezählt minus Soll, bewertet (nur gezählte Zeilen). */
  diffCents: number;
}

/** Summen einer Inventur, wie die Zeile „Gesamt“ der Excel-Liste. */
export function stocktakeTotals(lines: StocktakeLineLike[]): StocktakeTotals {
  const t: StocktakeTotals = { lines: lines.length, counted: 0, valueCents: 0, brokenCents: 0, diffCents: 0 };
  for (const l of lines) {
    if (l.counted != null) {
      t.counted++;
      t.valueCents += valueCents(l.counted, l.purchasePriceCents);
      t.diffCents += valueCents(l.counted - l.expected, l.purchasePriceCents);
    }
    t.brokenCents += valueCents(l.broken, l.purchasePriceCents);
  }
  return t;
}

/** Summen je Kategorie (Blatt „Zusammenfassung“ der Excel-Datei). */
export function totalsByCategory(lines: StocktakeLineLike[]): { category: string; totals: StocktakeTotals }[] {
  const map = new Map<string, StocktakeLineLike[]>();
  for (const l of lines) {
    const list = map.get(l.category) ?? [];
    list.push(l);
    map.set(l.category, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "de"))
    .map(([category, list]) => ({ category, totals: stocktakeTotals(list) }));
}

/** CSV mit Semikolon (Excel, deutsch). Felder mit ; " oder Zeilenumbruch in Anführungszeichen. */
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v == null) return "";
    const s = typeof v === "number" ? v.toLocaleString("de-DE", { maximumFractionDigits: 3, useGrouping: false }) : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM, damit Excel Umlaute richtig liest.
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Vorschlag für den nächsten Stichtag: 31.12. des laufenden Jahres, im Januar der des Vorjahres. */
export function defaultCutoffDate(now = new Date()): string {
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return `${year}-12-31`;
}

/** Jahr der nächsten Inventarzählung (wie die Spalten „Menge 2025“ der Vorlage). */
export function defaultAssetYear(now = new Date()): number {
  return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
}

/** Jahre für Spalten und Dialog des Inventars: aus den Daten plus Zähljahr, aufsteigend. */
export function assetYears(assets: { counts: Record<number, number> }[], year: number): number[] {
  const set = new Set<number>([year]);
  for (const a of assets) for (const y of Object.keys(a.counts)) set.add(Number(y));
  return [...set].sort((a, b) => a - b);
}

// ─── Bildsuche (Open Food Facts) ────────────────────────────────────────────

/** Normalisiert für den Namensvergleich: klein, ohne Akzente, nur Wörter. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Füllwörter und Mengenangaben zählen beim Vergleich nicht. */
const STOP = new Set([
  "bio", "vegan", "qba", "qb", "trocken", "fl", "flasche", "l", "ml", "cl", "kg", "g", "stuck", "stk",
  "und", "mit", "de", "la", "le", "the", "of", "0", "1", "2", "3", "5", "7", "25", "33", "5l", "75",
]);

export function nameTokens(s: string): string[] {
  return normalizeName(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+([.,]\d+)?(l|ml|cl|g|kg)?$/.test(t));
}

/**
 * Wie gut passt ein Treffer zum Artikelnamen (0–1)? Anteil der Wörter des
 * Artikels, die im Produktnamen oder der Marke vorkommen. Ein Bild wird nur
 * automatisch übernommen, wenn alle wesentlichen Wörter passen; sonst bleibt
 * der Platzhalter, damit kein falsches Produkt im Bestand auftaucht.
 */
export function matchScore(articleName: string, productName: string, brands = ""): number {
  const want = nameTokens(articleName);
  if (want.length === 0) return 0;
  const have = new Set(nameTokens(`${productName} ${brands}`));
  let hits = 0;
  for (const w of want) {
    if (have.has(w) || [...have].some((h) => h.length >= 4 && w.length >= 4 && (h.startsWith(w) || w.startsWith(h)))) hits++;
  }
  return hits / want.length;
}

/** Ab diesem Wert übernimmt die automatische Suche das Bild. */
export const AUTO_MATCH_MIN = 1;

export interface ImageCandidate {
  code: string;
  name: string;
  brands: string;
  imageUrl: string;
  productUrl: string;
  score: number;
}

interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_de?: string;
  brands?: string;
  image_front_url?: string;
  image_front_small_url?: string;
  image_url?: string;
}

/** Antwort der Open-Food-Facts-Suche in Kandidaten, beste zuerst. */
export function candidatesFromOff(articleName: string, products: OffProduct[]): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  for (const p of products) {
    const imageUrl = p.image_front_url || p.image_url || p.image_front_small_url;
    if (!imageUrl || !p.code || !/^https:\/\//.test(imageUrl)) continue;
    const name = p.product_name_de || p.product_name || "";
    out.push({
      code: p.code,
      name,
      brands: p.brands ?? "",
      imageUrl,
      productUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(p.code)}`,
      score: matchScore(articleName, name, p.brands ?? ""),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Suchbegriff für Open Food Facts: Name ohne Mengen und Füllwörter. */
export function offSearchTerms(articleName: string): string {
  return nameTokens(articleName).join(" ");
}
