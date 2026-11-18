/**
 * Excel-Import der Warenwirtschaft. Erkennt die Blätter an ihren Spalten:
 *
 *  - Inventurliste (Spalten „Bezeichnung“/„Produkt“ und „EK netto“/„Preis
 *    pro Einheit“): Artikel, Kategorie = Blattname ohne „Inventur“. Steht im
 *    Kopf ein Datum („Inventur zum 31.12.2025“), wird daraus zusätzlich eine
 *    festgeschriebene Stichtagsinventur mit den Ist-Mengen und dem Bruch.
 *  - Inventarliste (Spalte „Gerätenummer“): Inventar, Blatt = Blattname,
 *    Mengen aus den Spalten „Menge 31.12.20“, „Menge 2025“ usw.
 *
 * Reine Funktion ohne Datenbank, damit sie testbar bleibt.
 */
import { excelSerialToIso, type Cell, type Sheet } from "@/lib/xlsx-read";

export interface ImportArticle {
  name: string;
  sku: string | null;
  category: string;
  unit: string | null;
  supplier: string | null;
  purchasePriceCents: number | null;
  stock: number;
  broken: number | null;
}

export interface ImportAsset {
  name: string;
  group: string;
  location: string | null;
  deviceNumber: string | null;
  lastInspection: string | null;
  counts: { year: number; quantity: number }[];
}

export interface ImportResult {
  articles: ImportArticle[];
  /** Stichtag aus dem Kopf der Inventurliste, z. B. „2025-12-31“. */
  cutoffDate: string | null;
  assets: ImportAsset[];
  /** Blätter, die nicht erkannt wurden (nur Hinweis). */
  skipped: string[];
}

/** Blattnamen der Vorlage, die anders heißen sollen. */
const GROUP_NAMES: Record<string, string> = { "BüroShop": "Büro & Shop", BueroShop: "Büro & Shop" };

function text(v: Cell): string | null {
  if (v == null) return null;
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : v.trim();
  return s ? s : null;
}

function num(v: Cell): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim().replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

function norm(v: Cell): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function findCol(header: Cell[], ...patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(norm(h)));
    if (i >= 0) return i;
  }
  return -1;
}

/** Jahr aus einem Spaltenkopf: „Menge 31.12.20“ → 2020, „Menge 2025“ → 2025, Datumszahl → Jahr. */
export function yearFromHeader(h: Cell): number | null {
  if (typeof h === "number") {
    if (h > 20000 && h < 80000) return Number(excelSerialToIso(h).slice(0, 4));
    if (h >= 2000 && h <= 2100) return h;
    return null;
  }
  if (!h) return null;
  const four = h.match(/(20\d{2})/);
  if (four) return Number(four[1]);
  const two = h.match(/\d{1,2}\.\d{1,2}\.(\d{2})\s*$/);
  if (two) return 2000 + Number(two[1]);
  return null;
}

/** Datum „31.12.2025“ aus einem Text. */
function dateFromText(s: string): string | null {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function dateCell(v: Cell): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) return excelSerialToIso(v);
  if (typeof v === "string") return dateFromText(v);
  return null;
}

export function parseWawiWorkbook(sheets: Sheet[]): ImportResult {
  const res: ImportResult = { articles: [], cutoffDate: null, assets: [], skipped: [] };

  for (const sheet of sheets) {
    const headerIdx = sheet.rows.slice(0, 6).findIndex((r) => r.some((c) => /^(bezeichnung|produkt|artikel|gerätenummer)$/.test(norm(c))));
    if (headerIdx < 0) {
      // Kopf ohne Tabelle (z. B. „Zusammenfassung“): nur das Stichtagsdatum lesen.
      for (const r of sheet.rows.slice(0, 6)) for (const c of r) if (typeof c === "string" && /inventur/i.test(c)) res.cutoffDate ??= dateFromText(c);
      res.skipped.push(sheet.name);
      continue;
    }
    const header = sheet.rows[headerIdx];
    for (const r of sheet.rows.slice(0, headerIdx)) for (const c of r) if (typeof c === "string") res.cutoffDate ??= dateFromText(c);
    const body = sheet.rows.slice(headerIdx + 1);

    const deviceCol = findCol(header, /^gerätenummer/);
    if (deviceCol >= 0) {
      const nameCol = Math.max(0, findCol(header, /^artikel$/, /^bezeichnung$/));
      const locCol = findCol(header, /^bereich/);
      const inspCol = findCol(header, /prüfung/);
      const yearCols = header
        .map((h, i) => ({ i, year: i > Math.max(locCol, deviceCol, inspCol) ? yearFromHeader(h) : null }))
        .filter((x): x is { i: number; year: number } => x.year != null);
      const group = GROUP_NAMES[sheet.name] ?? sheet.name.trim();
      for (const r of body) {
        const name = text(r[nameCol] ?? null);
        if (!name) continue;
        const counts = new Map<number, number>();
        for (const { i, year } of yearCols) {
          const q = num(r[i] ?? null);
          if (q != null) counts.set(year, q);
        }
        res.assets.push({
          name,
          group,
          location: locCol >= 0 ? text(r[locCol] ?? null) : null,
          deviceNumber: text(r[deviceCol] ?? null),
          lastInspection: inspCol >= 0 ? dateCell(r[inspCol] ?? null) : null,
          counts: [...counts].map(([year, quantity]) => ({ year, quantity })),
        });
      }
      continue;
    }

    const nameCol = findCol(header, /^bezeichnung$/, /^produkt$/, /^artikel$/);
    const priceCol = findCol(header, /^ek/, /preis/);
    if (nameCol < 0 || priceCol < 0) {
      res.skipped.push(sheet.name);
      continue;
    }
    const skuCol = findCol(header, /^artikel-?\s?nr/);
    const unitCol = findCol(header, /^einheit/);
    const supplierCol = findCol(header, /^lieferant/);
    const qtyCol = findCol(header, /^ist/, /^bestand/, /^menge$/);
    const brokenCol = findCol(header, /^bruch(\s*menge)?$/);
    const category = sheet.name.replace(/^inventur\s*/i, "").trim() || "Sonstiges";
    for (const r of body) {
      const name = text(r[nameCol] ?? null);
      if (!name || /^(gesamt|summe)/i.test(name)) continue;
      const price = num(r[priceCol] ?? null);
      res.articles.push({
        name,
        sku: skuCol >= 0 ? text(r[skuCol] ?? null) : null,
        category,
        unit: unitCol >= 0 ? text(r[unitCol] ?? null) : null,
        supplier: supplierCol >= 0 ? text(r[supplierCol] ?? null) : null,
        purchasePriceCents: price == null ? null : Math.round(price * 100),
        stock: (qtyCol >= 0 ? num(r[qtyCol] ?? null) : null) ?? 0,
        broken: brokenCol >= 0 ? num(r[brokenCol] ?? null) : null,
      });
    }
  }
  if (res.articles.length === 0) res.cutoffDate = null;
  return res;
}

/** Schlüssel für „schon vorhanden“ beim erneuten Import derselben Datei. */
export function articleKey(a: { name: string; category: string; unit: string | null; sku: string | null }): string {
  return [a.name.toLowerCase(), a.category.toLowerCase(), a.unit?.toLowerCase() ?? "", a.sku ?? ""].join("|");
}

export function assetKey(a: { name: string; group: string; location: string | null; deviceNumber: string | null }): string {
  return [a.name.toLowerCase(), a.group.toLowerCase(), a.location?.toLowerCase() ?? "", a.deviceNumber ?? ""].join("|");
}
