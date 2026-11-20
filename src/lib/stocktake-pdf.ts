import { jsPDF } from "jspdf";
import { stocktakeTotals, totalsByCategory, valueCents, type StocktakeLineLike } from "./warenwirtschaft";
import {
  FIELD_LABEL,
  METHOD_LABEL,
  ROLE_LABEL,
  STOCKTAKE_ROLES,
  VIA_LABEL,
  describeEvent,
  formatFieldValue,
  shortHash,
  type LineField,
  type StocktakeEventLike,
  type StocktakeRole,
} from "./stocktake-log";

/**
 * Inventurliste als A4-PDF für Ablage und Steuerberater: Kopf mit Betrieb
 * und Stichtag, je Kategorie eine Tabelle mit Zwischensumme, danach die
 * Zusammenfassung mit Gesamtwert, der digitalen Bestätigung durch Zähler und
 * Schreiber (statt Unterschrift), den Korrekturen nach dem Festschreiben und
 * im Anhang dem vollständigen Protokoll.
 *
 * Bewertet wird wie in der App (`stocktakeTotals`): gezählte Menge mal
 * Einkaufspreis netto. Zeilen ohne Zählung oder mit Menge 0 erscheinen
 * nicht in der Liste, ihr Wert ist ohnehin 0.
 */

export interface StocktakePdfLine extends StocktakeLineLike {
  name: string;
  sku: string | null;
  unit: string | null;
}

export interface StocktakePdfInput {
  accountName: string;
  kind: "ROLLING" | "CUTOFF";
  title: string;
  /** Stichtag bzw. Zähltag, 00:00 UTC. */
  date: Date;
  status: "OPEN" | "CLOSED";
  closedAt: Date | null;
  closedBy: string | null;
  lines: StocktakePdfLine[];
  /** Digitale Bestätigungen (Zähler, Schreiber). */
  signatures?: StocktakePdfSignature[];
  /** Protokoll, beliebige Reihenfolge (wird nach Zeit sortiert). */
  events?: StocktakePdfEvent[];
  /** Zeitpunkt der Erstellung (für Tests fest vorgebbar). */
  createdAt?: Date;
}

export interface StocktakePdfSignature {
  role: StocktakeRole;
  name: string;
  email: string | null;
  method: string;
  signedAt: Date;
  contentHash: string;
}

export interface StocktakePdfEvent extends StocktakeEventLike {
  createdAt: Date;
}

/** Standardschrift im PDF kennt keinen Pfeil. */
const pdfSafe = (s: string) => s.replace(/→/g, "->");

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16;
const RIGHT = PAGE_W - M;
const FOOTER_Y = PAGE_H - 10;
const BOTTOM = PAGE_H - 18;
const ROW_H = 5.6;

// Graustufen statt Farbe: druckt sauber und bleibt ruhig.
const INK = 20;
const MUTED = 105;
const LINE = 205;
const FILL = 244;

/** „1.234,50 €“ – eigene Formatierung, damit kein schmales Leerzeichen im PDF landet. */
export function pdfEuro(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "–";
  const s = (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s.replace(/\s/g, "")} €`;
}

function pdfQty(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return "–";
  return q.toLocaleString("de-DE", { maximumFractionDigits: 3 });
}

function dateDe(d: Date, utc = false): string {
  return d.toLocaleDateString("de-DE", { timeZone: utc ? "UTC" : "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
}

function dateTimeDe(d: Date): string {
  return `${dateDe(d)}, ${d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} Uhr`;
}

/** Dateiname ohne Sonderzeichen, z. B. „Inventur_31.12.2025.pdf“. */
export function stocktakePdfFileName(title: string): string {
  const base = title.replace(/[^\wäöüÄÖÜß.-]+/g, "_").replace(/^_+|_+$/g, "") || "Inventur";
  return `${base}.pdf`;
}

interface Col {
  label: string;
  width: number;
  align: "left" | "right";
}

export function buildStocktakePdf(input: StocktakePdfInput): ArrayBuffer {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const createdAt = input.createdAt ?? new Date();
  const cutoff = input.kind === "CUTOFF";
  const closed = input.status === "CLOSED";
  const totals = stocktakeTotals(input.lines);
  const byCategory = totalsByCategory(input.lines);
  const listed = input.lines.filter((l) => (l.counted != null && l.counted !== 0) || (l.broken ?? 0) !== 0);
  const showBroken = input.lines.some((l) => (l.broken ?? 0) !== 0);
  const showSku = listed.some((l) => l.sku);
  const unpriced = listed.filter((l) => l.purchasePriceCents == null && (l.counted ?? 0) !== 0).length;
  const uncounted = input.lines.filter((l) => l.counted == null).length;
  const dateLabel = dateDe(input.date, true);

  let y = M;

  const text = (s: string, x: number, yy: number, opts: { align?: "left" | "right"; bold?: boolean; size?: number; color?: number } = {}) => {
    pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    pdf.setFontSize(opts.size ?? 9);
    pdf.setTextColor(opts.color ?? INK);
    pdf.text(s, x, yy, { align: opts.align ?? "left" });
  };

  const hairline = (yy: number, color = LINE) => {
    pdf.setDrawColor(color);
    pdf.setLineWidth(0.2);
    pdf.line(M, yy, RIGHT, yy);
  };

  // Spalten der Artikeltabelle; die Bezeichnung nimmt den Rest.
  const cols: Col[] = [
    ...(showSku ? [{ label: "Art.-Nr.", width: 20, align: "left" as const }] : []),
    { label: "Bezeichnung", width: 0, align: "left" },
    { label: "Einheit", width: 20, align: "left" },
    { label: "Menge", width: 17, align: "right" },
    ...(showBroken ? [{ label: "Bruch", width: 15, align: "right" as const }] : []),
    { label: "EK netto", width: 21, align: "right" },
    { label: "Wert netto", width: 25, align: "right" },
  ];
  const fixed = cols.reduce((s, c) => s + c.width, 0);
  cols.find((c) => c.width === 0)!.width = RIGHT - M - fixed;
  const colX = (i: number) => {
    let x = M;
    for (let k = 0; k < i; k++) x += cols[k].width;
    return cols[i].align === "right" ? x + cols[i].width - 1.5 : x + (i === 0 ? 0 : 1.5);
  };
  const nameIdx = cols.findIndex((c) => c.label === "Bezeichnung");

  const tableHead = () => {
    pdf.setFillColor(FILL, FILL, FILL);
    pdf.rect(M, y - 3.9, RIGHT - M, ROW_H, "F");
    cols.forEach((c, i) => text(c.label, colX(i), y, { align: c.align, bold: true, size: 8, color: MUTED }));
    y += ROW_H;
  };

  /** Neue Seite, wenn `needed` mm nicht mehr passen; Tabellenkopf ggf. wiederholen. */
  const ensure = (needed: number, repeat?: { category: string }) => {
    if (y + needed <= BOTTOM) return;
    pdf.addPage();
    y = M + 4;
    if (repeat) {
      text(`${repeat.category} (Fortsetzung)`, M, y, { bold: true, size: 10 });
      y += 6;
      tableHead();
    }
  };

  // ── Kopf ────────────────────────────────────────────────
  text(input.accountName, M, y + 1, { bold: true, size: 10, color: MUTED });
  text(cutoff ? "Stichtagsinventur" : "Inventur", RIGHT, y + 1, { align: "right", size: 9, color: MUTED });
  y += 10;
  text(cutoff ? `Inventur zum ${dateLabel}` : input.title, M, y, { bold: true, size: 18 });
  y += 7;
  if (cutoff && input.title && !input.title.includes(dateLabel)) {
    text(input.title, M, y, { size: 10, color: MUTED });
    y += 5.5;
  }
  hairline(y, 170);
  y += 6;

  // Eckdaten in zwei Spalten.
  const facts: [string, string][] = [
    [cutoff ? "Stichtag" : "Zähltag", dateLabel],
    [
      "Status",
      closed
        ? `festgeschrieben${input.closedAt ? ` am ${dateDe(input.closedAt)}` : ""}`
        : "vorläufig, noch nicht festgeschrieben",
    ],
    ["Bewertung", "Einkaufspreise netto"],
    ["Erstellt", dateTimeDe(createdAt)],
    ...(closed && input.closedBy ? ([["Abschluss", `durch ${input.closedBy}`]] as [string, string][]) : []),
  ];
  facts.forEach(([label, value], i) => {
    const x = i % 2 === 0 ? M : M + (RIGHT - M) / 2;
    const yy = y + Math.floor(i / 2) * 5.2;
    text(label, x, yy, { size: 8.5, color: MUTED });
    const v = pdf.splitTextToSize(value, (RIGHT - M) / 2 - 24)[0] as string;
    text(v, x + 22, yy, { size: 8.5 });
  });
  y += Math.ceil(facts.length / 2) * 5.2 + 3;

  // Kennzahlen-Leiste.
  const boxH = 15;
  pdf.setDrawColor(LINE);
  pdf.setLineWidth(0.2);
  pdf.roundedRect(M, y, RIGHT - M, boxH, 2, 2, "S");
  const kpis: [string, string][] = [
    ["Gesamtwert netto", pdfEuro(totals.valueCents)],
    ["Artikel gezählt", `${totals.counted} von ${totals.lines}`],
    ["Kategorien", String(byCategory.length)],
    ...(showBroken ? ([["Bruch netto", pdfEuro(totals.brokenCents)]] as [string, string][]) : []),
  ];
  const kw = (RIGHT - M) / kpis.length;
  kpis.forEach(([label, value], i) => {
    const x = M + i * kw + 4;
    text(label, x, y + 5.2, { size: 7.5, color: MUTED });
    text(value, x, y + 11, { size: i === 0 ? 12 : 10.5, bold: i === 0 });
  });
  y += boxH + 4;

  const notes: string[] = [];
  if (!closed) notes.push("Die Inventur ist noch offen. Mengen und Werte können sich bis zum Festschreiben ändern.");
  if (uncounted > 0) notes.push(`${uncounted} Artikel sind nicht gezählt und nicht bewertet.`);
  if (unpriced > 0) notes.push(`${unpriced} Artikel haben keinen Einkaufspreis und sind mit 0 € bewertet.`);
  notes.push("Aufgeführt sind alle Artikel mit Bestand. Artikel mit Menge 0 sind nicht aufgeführt.");
  for (const n of notes) {
    for (const line of pdf.splitTextToSize(n, RIGHT - M) as string[]) {
      text(line, M, y, { size: 8, color: MUTED });
      y += 4;
    }
  }
  y += 4;

  // ── Tabellen je Kategorie ───────────────────────────────
  for (const { category, totals: ct } of byCategory) {
    const rows = listed
      .filter((l) => l.category === category)
      .sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
    if (rows.length === 0) continue;

    ensure(6 + ROW_H * 3);
    text(category, M, y, { bold: true, size: 11 });
    text(`${rows.length} Artikel`, RIGHT, y, { align: "right", size: 8, color: MUTED });
    y += 5;
    tableHead();

    for (const l of rows) {
      pdf.setFontSize(8.5);
      const nameLines = pdf.splitTextToSize(l.name, cols[nameIdx].width - 3) as string[];
      const h = ROW_H + (nameLines.length - 1) * 3.6;
      ensure(h, { category });
      const cells: string[] = [
        ...(showSku ? [l.sku ?? ""] : []),
        "",
        l.unit ?? "",
        pdfQty(l.counted),
        ...(showBroken ? [l.broken ? pdfQty(l.broken) : ""] : []),
        pdfEuro(l.purchasePriceCents),
        l.counted == null ? "–" : pdfEuro(valueCents(l.counted, l.purchasePriceCents)),
      ];
      cells.forEach((c, i) => {
        if (i === nameIdx) {
          nameLines.forEach((nl, k) => text(nl, colX(i), y + k * 3.6, { size: 8.5 }));
        } else {
          const fit = cols[i].align === "left" ? ((pdf.splitTextToSize(c, cols[i].width - 2) as string[])[0] ?? "") : c;
          text(fit, colX(i), y, { size: 8.5, align: cols[i].align, color: i === cols.length - 1 ? INK : 60 });
        }
      });
      y += h - 3.9;
      hairline(y + 0.2, 228);
      y += 3.9;
    }

    // Zwischensumme der Kategorie.
    ensure(ROW_H + 2);
    hairline(y - 3.9, 150);
    text(`Summe ${category}`, colX(nameIdx), y + 0.6, { bold: true, size: 8.5 });
    if (showBroken) text(pdfEuro(ct.brokenCents), colX(cols.length - 3), y + 0.6, { align: "right", size: 8.5, color: MUTED });
    text(pdfEuro(ct.valueCents), colX(cols.length - 1), y + 0.6, { align: "right", bold: true, size: 8.5 });
    y += ROW_H + 6;
  }

  // ── Zusammenfassung ─────────────────────────────────────
  const sumRows = byCategory.length + 2;
  ensure(14 + sumRows * ROW_H + 30);
  text("Zusammenfassung", M, y, { bold: true, size: 11 });
  y += 5;
  const sx = { cat: M + 1.5, count: RIGHT - 60, broken: RIGHT - 32, value: RIGHT - 1.5 };
  pdf.setFillColor(FILL, FILL, FILL);
  pdf.rect(M, y - 3.9, RIGHT - M, ROW_H, "F");
  text("Kategorie", sx.cat, y, { bold: true, size: 8, color: MUTED });
  text("Artikel", sx.count, y, { bold: true, size: 8, color: MUTED, align: "right" });
  if (showBroken) text("Bruch netto", sx.broken, y, { bold: true, size: 8, color: MUTED, align: "right" });
  text("Wert netto", sx.value, y, { bold: true, size: 8, color: MUTED, align: "right" });
  y += ROW_H;
  for (const { category, totals: ct } of byCategory) {
    text(category, sx.cat, y, { size: 9 });
    text(String(listed.filter((l) => l.category === category).length), sx.count, y, { size: 9, align: "right", color: 60 });
    if (showBroken) text(pdfEuro(ct.brokenCents), sx.broken, y, { size: 9, align: "right", color: 60 });
    text(pdfEuro(ct.valueCents), sx.value, y, { size: 9, align: "right" });
    hairline(y + 1.7, 228);
    y += ROW_H;
  }
  pdf.setDrawColor(INK);
  pdf.setLineWidth(0.4);
  pdf.line(M, y - 3.6, RIGHT, y - 3.6);
  y += 1;
  text("Gesamtwert netto", sx.cat, y, { bold: true, size: 10.5 });
  text(String(listed.length), sx.count, y, { bold: true, size: 9, align: "right" });
  if (showBroken) text(pdfEuro(totals.brokenCents), sx.broken, y, { size: 9, align: "right" });
  text(pdfEuro(totals.valueCents), sx.value, y, { bold: true, size: 10.5, align: "right" });
  y += 12;

  // ── Bestätigung (statt Unterschrift) ───────────────────
  const signatures = input.signatures ?? [];
  const events = [...(input.events ?? [])].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const half = (RIGHT - M) / 2;

  const para = (s: string, size = 8, color = MUTED) => {
    for (const line of pdf.splitTextToSize(s, RIGHT - M) as string[]) {
      ensure(4.2);
      text(line, M, y, { size, color });
      y += 4;
    }
  };

  ensure(14 + ROW_H * 3);
  text("Bestätigung", M, y, { bold: true, size: 11 });
  y += 5;
  if (signatures.length > 0 || !closed) {
    const bx = { role: M + 1.5, name: M + 24, at: M + 84, method: M + 122, hash: RIGHT - 1.5 };
    pdf.setFillColor(FILL, FILL, FILL);
    pdf.rect(M, y - 3.9, RIGHT - M, ROW_H, "F");
    text("Rolle", bx.role, y, { bold: true, size: 8, color: MUTED });
    text("Name", bx.name, y, { bold: true, size: 8, color: MUTED });
    text("Bestätigt am", bx.at, y, { bold: true, size: 8, color: MUTED });
    text("Verfahren", bx.method, y, { bold: true, size: 8, color: MUTED });
    text("Prüfsumme", bx.hash, y, { bold: true, size: 8, color: MUTED, align: "right" });
    y += ROW_H;
    for (const role of STOCKTAKE_ROLES) {
      const sig = signatures.find((g) => g.role === role);
      ensure(ROW_H + 4);
      text(ROLE_LABEL[role], bx.role, y, { size: 9, bold: true });
      if (sig) {
        const who = (pdf.splitTextToSize(sig.name, bx.at - bx.name - 3) as string[])[0] ?? "";
        text(who, bx.name, y, { size: 9 });
        if (sig.email) text((pdf.splitTextToSize(sig.email, bx.at - bx.name - 3) as string[])[0] ?? "", bx.name, y + 3.6, { size: 7, color: MUTED });
        text(dateTimeDe(sig.signedAt), bx.at, y, { size: 8.5 });
        text(METHOD_LABEL[sig.method] ?? sig.method, bx.method, y, { size: 8.5 });
        text(shortHash(sig.contentHash), bx.hash, y, { size: 7.5, align: "right", color: 60 });
      } else {
        text("noch nicht bestätigt", bx.name, y, { size: 9, color: MUTED });
      }
      y += sig?.email ? ROW_H + 3 : ROW_H;
      hairline(y - 3.9, 228);
    }
    y += 2;
    para(
      "Zähler und Schreiber haben die Zählung jeweils mit ihrem persönlichen Login elektronisch bestätigt (Passkey bzw. Passwort). " +
        "Die Bestätigung ersetzt die Unterschrift. Die Prüfsumme (SHA-256) gehört zum Stand der Liste beim Bestätigen; " +
        "jede Eingabe und jede spätere Korrektur steht mit Person und Zeit im Protokoll.",
    );
  } else {
    para("Diese Inventur wurde vor Einführung der digitalen Bestätigung festgeschrieben bzw. übernommen. Bestätigung durch Unterschrift:");
    y += 12;
    ensure(10);
    pdf.setDrawColor(120);
    pdf.setLineWidth(0.2);
    pdf.line(M, y, M + half - 10, y);
    pdf.line(M + half + 10, y, RIGHT, y);
    text("Zähler: Ort, Datum, Unterschrift", M, y + 4, { size: 8, color: MUTED });
    text("Schreiber: Ort, Datum, Unterschrift", M + half + 10, y + 4, { size: 8, color: MUTED });
    y += 8;
  }
  y += 6;

  // ── Korrekturen nach dem Festschreiben ─────────────────
  const corrections = events.filter((e) => e.type === "CORRECTION");
  if (corrections.length > 0) {
    ensure(14 + ROW_H * 2);
    text("Korrekturen nach dem Festschreiben", M, y, { bold: true, size: 11 });
    text(`${corrections.length} ${corrections.length === 1 ? "Eintrag" : "Einträge"}`, RIGHT, y, { align: "right", size: 8, color: MUTED });
    y += 5;
    const cx = { at: M + 1.5, who: M + 30, what: M + 64, change: M + 118, wChange: RIGHT - (M + 118) - 1.5 };
    pdf.setFillColor(FILL, FILL, FILL);
    pdf.rect(M, y - 3.9, RIGHT - M, ROW_H, "F");
    text("Zeitpunkt", cx.at, y, { bold: true, size: 8, color: MUTED });
    text("Person", cx.who, y, { bold: true, size: 8, color: MUTED });
    text("Artikel", cx.what, y, { bold: true, size: 8, color: MUTED });
    text("Änderung und Grund", cx.change, y, { bold: true, size: 8, color: MUTED });
    y += ROW_H;
    for (const c of corrections) {
      pdf.setFontSize(8);
      const field = c.field && c.field in FIELD_LABEL ? FIELD_LABEL[c.field as LineField] : c.field ?? "";
      const change = pdf.splitTextToSize(
        pdfSafe(`${field}: ${formatFieldValue(c.field, c.oldValue)} → ${formatFieldValue(c.field, c.newValue)}${c.note ? `. Grund: ${c.note}` : ""}`),
        cx.wChange,
      ) as string[];
      const what = pdf.splitTextToSize(c.lineName ?? "", cx.change - cx.what - 3) as string[];
      const rows = Math.max(change.length, what.length, 1);
      const h = ROW_H + (rows - 1) * 3.5;
      ensure(h);
      text(dateTimeDe(c.createdAt).replace(" Uhr", ""), cx.at, y, { size: 8 });
      text((pdf.splitTextToSize(c.actor, cx.what - cx.who - 3) as string[])[0] ?? "", cx.who, y, { size: 8 });
      what.forEach((l, k) => text(l, cx.what, y + k * 3.5, { size: 8 }));
      change.forEach((l, k) => text(l, cx.change, y + k * 3.5, { size: 8 }));
      y += h - 3.9;
      hairline(y + 0.2, 228);
      y += 3.9;
    }
    y += 4;
  }

  // ── Anhang: vollständiges Protokoll ────────────────────
  if (events.length > 0) {
    pdf.addPage();
    y = M + 4;
    text("Anhang: Protokoll", M, y, { bold: true, size: 13 });
    text(`${events.length} Einträge`, RIGHT, y, { align: "right", size: 8, color: MUTED });
    y += 5;
    para("Alle Eingaben, Bestätigungen, das Festschreiben und Korrekturen in zeitlicher Reihenfolge. Einträge werden nur angehängt, nie geändert.");
    y += 3;
    const px = { at: M + 1.5, who: M + 30, what: M + 70, wWhat: RIGHT - (M + 70) - 1.5 };
    const head = () => {
      pdf.setFillColor(FILL, FILL, FILL);
      pdf.rect(M, y - 3.6, RIGHT - M, 5, "F");
      text("Zeitpunkt", px.at, y, { bold: true, size: 7.5, color: MUTED });
      text("Person", px.who, y, { bold: true, size: 7.5, color: MUTED });
      text("Eintrag", px.what, y, { bold: true, size: 7.5, color: MUTED });
      y += 5;
    };
    head();
    for (const e of events) {
      pdf.setFontSize(7.5);
      const what = pdf.splitTextToSize(pdfSafe(describeEvent(e)), px.wWhat) as string[];
      const who = `${e.actor}${e.via !== "app" ? ` (${VIA_LABEL[e.via] ?? e.via})` : ""}`;
      const h = 4.4 + (what.length - 1) * 3.2;
      if (y + h > BOTTOM) {
        pdf.addPage();
        y = M + 4;
        text("Protokoll (Fortsetzung)", M, y, { bold: true, size: 10 });
        y += 6;
        head();
      }
      text(dateTimeDe(e.createdAt).replace(" Uhr", ""), px.at, y, { size: 7.5, color: 60 });
      text((pdf.splitTextToSize(who, px.what - px.who - 3) as string[])[0] ?? "", px.who, y, { size: 7.5, color: 60 });
      what.forEach((l, k) => text(l, px.what, y + k * 3.2, { size: 7.5 }));
      y += h;
    }
  }

  // ── Fußzeile auf jeder Seite ────────────────────────────
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    hairline(FOOTER_Y - 4, LINE);
    text(`${input.accountName} · ${cutoff ? `Inventur zum ${dateLabel}` : input.title}`, M, FOOTER_Y, { size: 7.5, color: MUTED });
    text(`Seite ${p} von ${pages}`, RIGHT, FOOTER_Y, { size: 7.5, color: MUTED, align: "right" });
  }

  pdf.setProperties({
    title: `${cutoff ? `Inventur zum ${dateLabel}` : input.title} – ${input.accountName}`,
    subject: "Inventurliste",
    author: input.accountName,
    creator: "EMP Access",
  });

  return pdf.output("arraybuffer");
}
