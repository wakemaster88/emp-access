/**
 * Minimaler Excel-Leser (.xlsx) ohne Fremdpaket: entpackt die nötigen XML-
 * Dateien mit zlib und liest Zellwerte. Formeln liefern ihren zuletzt in
 * Excel berechneten Wert (`<v>`). Reicht für Listen-Importe; Formatierung,
 * verbundene Zellen und Datumsformate werden nicht ausgewertet (Datumszahlen
 * bleiben Zahlen, siehe `excelSerialToIso`).
 */
import { inflateRawSync } from "node:zlib";

export type Cell = string | number | null;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

const MAX_UNZIPPED = 50 * 1024 * 1024;
/** Höchste Zeilennummer, die gelesen wird (Listen-Importe brauchen weit weniger). */
export const MAX_ROW = 200_000;
/** Spalten wie in Excel: A bis XFD. */
export const MAX_COLS = 16_384;
/** Höchstens so viele `<row>`-Einträge über alle Blätter. */
export const MAX_ROWS_TOTAL = 200_000;
/** Höchstens so viele Zellen im Ergebnis (Lücken mitgezählt). */
export const MAX_CELLS = 5_000_000;
const TOO_BIG = "Excel-Datei ist zu groß";

function unzip(buf: Buffer, wanted: (name: string) => boolean): Map<string, string> {
  // Ende des zentralen Verzeichnisses suchen (Signatur 0x06054b50).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Keine gültige Excel-Datei (.xlsx)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Excel-Datei ist beschädigt");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }) : null;
    if (!raw) continue;
    total += raw.length;
    if (total > MAX_UNZIPPED) throw new Error("Excel-Datei ist zu groß");
    out.set(name, raw.toString("utf8"));
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Text aller `<t>`-Knoten (auch Rich-Text-Läufe) zusammengesetzt. */
function textOf(xml: string): string {
  let s = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1];
  return decode(s);
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
    if (n > MAX_COLS) throw new Error(TOO_BIG);
  }
  return n - 1;
}

function attr(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
}

export function readXlsx(buf: Buffer): Sheet[] {
  const files = unzip(buf, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const wb = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (!wb || !rels) throw new Error("Keine gültige Excel-Datei (.xlsx)");

  const shared: string[] = [];
  const sst = files.get("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const t = attr(m[0], "Target");
    if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
  }

  const sheets: Sheet[] = [];
  let rowsRead = 0;
  let cells = 0;
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(attr(m[0], "name") ?? "");
    const rid = attr(m[0], "r:id");
    const xml = rid ? files.get(target.get(rid) ?? "") : undefined;
    if (!xml) continue;
    // Zeilen nach Nummer (1-basiert) in einer Map statt per Index: die
    // Nummern stehen in der Datei und werden erst hier begrenzt.
    const rows = new Map<number, Cell[]>();
    let lastRow = 0;
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      if (++rowsRead > MAX_ROWS_TOTAL) throw new Error(TOO_BIG);
      const rowNum = Number(attr(r[0], "r")) || lastRow + 1;
      // Ungültige Nummern (negativ, Bruchzahl) fielen schon bisher weg.
      if (!Number.isInteger(rowNum) || rowNum < 1) continue;
      if (rowNum > MAX_ROW) throw new Error(TOO_BIG);
      lastRow = Math.max(lastRow, rowNum);
      const values = new Map<number, Cell>();
      let width = 0;
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1]}>`;
        const ref = attr(tag, "r");
        const type = attr(tag, "t");
        const body = c[2] ?? "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value: Cell = null;
        if (type === "s" && v != null) value = shared[Number(v)] ?? null;
        else if (type === "inlineStr") value = textOf(body);
        else if (type === "str" || type === "e") value = v != null ? decode(v) : null;
        else if (type === "b") value = v === "1" ? 1 : 0;
        else if (v != null && v !== "") value = Number(v);
        const col = ref ? colIndex(ref) : width;
        values.set(col, value);
        width = Math.max(width, col + 1);
      }
      // Zellen fortlaufend zählen, bevor die Zeile dicht aufgebaut wird
      // (Lücken bis zur höchsten Zeilennummer mitgezählt).
      cells += width;
      if (cells + lastRow > MAX_CELLS) throw new Error(TOO_BIG);
      rows.set(rowNum, Array.from({ length: width }, (_, i) => values.get(i) ?? null));
    }
    // Lücken als leere Zeilen auffüllen wie bisher.
    cells += lastRow;
    if (cells > MAX_CELLS) throw new Error(TOO_BIG);
    sheets.push({ name, rows: Array.from({ length: lastRow }, (_, i) => rows.get(i + 1) ?? []) });
  }
  return sheets;
}

/** Excel-Datumszahl (Tage seit 1899-12-30) als „YYYY-MM-DD“. */
export function excelSerialToIso(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000);
  return d.toISOString().slice(0, 10);
}
