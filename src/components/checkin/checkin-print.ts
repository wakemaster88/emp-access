/**
 * Bondrucker-/PDF-Ausgaben des Check-in-Kiosks (jspdf wird erst beim Drucken geladen).
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { printPdfBlob, downloadBlob, type PrintResult } from "@/lib/print-tickets";
import type { CheckinTicket, GuestInfoSummary, TicketExtra } from "./checkin-types";
import { classifyInfoLabel, formatSetup, isYes, personName, sortSummaryValues } from "./checkin-utils";

// Farbpalette des Kursblatts (angelehnt an den Shop-Monitor: Slate + Cyan).
export const PDF_SLATE_900: [number, number, number] = [15, 23, 42];

export const PDF_SLATE_600: [number, number, number] = [71, 85, 105];

export const PDF_SLATE_400: [number, number, number] = [148, 163, 184];

export const PDF_SLATE_200: [number, number, number] = [226, 232, 240];

export const PDF_SLATE_50: [number, number, number] = [248, 250, 252];

export const PDF_CYAN_700: [number, number, number] = [14, 116, 144];

export const PDF_CYAN_500: [number, number, number] = [6, 182, 212];

export const PDF_CYAN_50: [number, number, number] = [236, 254, 255];

export const PDF_WHITE: [number, number, number] = [255, 255, 255];


/**
 * A4-Kursblatt fuer die Material-Vorbereitung eines Kurstages:
 *   1. Dunkles Kopfband mit Kurs, Datum, Account und Antwortquote
 *   2. Material-Karten (Setups) + Chip-Zeilen (Neopren, sonstige Infos)
 *   3. Teilnehmer-Tabelle (Zebra) mit allen Infos + Ausgabe-Checkbox
 * Wird im neuen Tab geoeffnet (Ansehen/Drucken/Speichern), mit
 * Download-Fallback falls der Popup geblockt wird.
 */
export async function exportCourseDayPdf(
  groupName: string,
  dateStr: string,
  accountName: string,
  summary: GuestInfoSummary,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 14;
  const contentW = pageW - margin * 2;

  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);
  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  const dateLabel = new Date(`${dateStr}T12:00:00`).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // ---- Kopfband -----------------------------------------------------------
  const headerH = 34;
  fill(PDF_SLATE_900);
  doc.rect(0, 0, pageW, headerH, "F");
  // Cyan-Akzentlinie an der Unterkante des Bands.
  fill(PDF_CYAN_500);
  doc.rect(0, headerH - 1.4, pageW, 1.4, "F");

  color(PDF_CYAN_500);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("TAGESÜBERSICHT", margin, 12, { charSpace: 0.6 });

  color(PDF_WHITE);
  doc.setFontSize(19);
  doc.text(groupName, margin, 21);

  color(PDF_SLATE_400);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`${dateLabel}${accountName ? `  ·  ${accountName}` : ""}`, margin, 28);

  // Antwortquote als Pill rechts im Kopfband.
  const statText = `${summary.answered}/${summary.total} beantwortet`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const statW = doc.getTextWidth(statText) + 8;
  fill(PDF_CYAN_500);
  doc.roundedRect(pageW - margin - statW, 13, statW, 8, 4, 4, "F");
  color(PDF_SLATE_900);
  doc.text(statText, pageW - margin - statW / 2, 18.2, { align: "center" });

  let y = headerH + 12;

  // Seitenumbruch-Helfer fuer die Sektionen.
  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 18) {
      doc.addPage();
      y = 18;
    }
  };

  // Sektions-Titel mit Cyan-Akzentbalken.
  const sectionTitle = (title: string) => {
    ensureSpace(14);
    fill(PDF_CYAN_500);
    doc.rect(margin, y - 3.4, 1.6, 4.4, "F");
    color(PDF_SLATE_900);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), margin + 4.5, y, { charSpace: 0.3 });
    y += 7;
    doc.setFont("helvetica", "normal");
  };

  // ---- Material-Karten ------------------------------------------------------
  if (summary.setups.length > 0) {
    sectionTitle("Material");
    const gap = 4;
    const perRow = 3;
    const cardW = (contentW - gap * (perRow - 1)) / perRow;
    const cardH = 17;
    for (let i = 0; i < summary.setups.length; i += perRow) {
      ensureSpace(cardH + gap);
      const rowItems = summary.setups.slice(i, i + perRow);
      let x = margin;
      for (const s of rowItems) {
        fill(PDF_SLATE_50);
        stroke(PDF_SLATE_200);
        doc.setLineWidth(0.3);
        doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, "FD");
        // Grosse Stueckzahl in Cyan.
        color(PDF_CYAN_700);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(`${s.count}×`, x + 4, y + 8.5);
        // Setup-Beschreibung daneben (ohne Schuhgroesse, die steht in der
        // Detail-Zeile darunter), max. 2 Zeilen.
        const countW = doc.getTextWidth(`${s.count}×`) + 7;
        color(PDF_SLATE_900);
        doc.setFontSize(9);
        const title = [s.sport, s.level].filter(Boolean).join(" · ") || formatSetup(s);
        const lines = (doc.splitTextToSize(title, cardW - countW - 4) as string[]).slice(0, 2);
        doc.text(lines, x + countW, y + 6.3);
        // Kleine Detail-Zeile: Schuhgroesse hervorheben, falls vorhanden.
        color(PDF_SLATE_600);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(
          s.shoe ? `Schuhgröße ${s.shoe}` : "ohne Schuhgröße",
          x + 4,
          y + cardH - 3.5,
        );
        x += cardW + gap;
      }
      y += cardH + gap;
    }
    y += 4;
  }

  // ---- Chip-Zeilen (Neopren + sonstige Labels) ------------------------------
  const chipRow = (title: string, entries: [string, number][]) => {
    sectionTitle(title);
    doc.setFontSize(8.5);
    let x = margin;
    const chipH = 7.5;
    for (const [value, count] of entries) {
      doc.setFont("helvetica", "bold");
      const text = `${value}  ×${count}`;
      const w = doc.getTextWidth(text) + 8;
      if (x + w > pageW - margin) {
        x = margin;
        y += chipH + 2.5;
        ensureSpace(chipH + 4);
      }
      fill(PDF_CYAN_50);
      stroke(PDF_CYAN_500);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, y, w, chipH, 3.5, 3.5, "FD");
      color(PDF_CYAN_700);
      doc.text(text, x + w / 2, y + 5, { align: "center" });
      x += w + 3;
    }
    y += chipH + 8;
  };

  if (summary.neopren.size > 0) {
    chipRow("Neoprenanzüge", sortSummaryValues(summary.neopren));
  }
  for (const [label, values] of summary.labels) {
    chipRow(label, sortSummaryValues(values));
  }

  // ---- Teilnehmer-Tabelle ---------------------------------------------------
  y += 1;
  sectionTitle(`Teilnehmer (${summary.total})`);

  // Tickets nach Slot + Teilnehmername sortieren.
  const participantName = (t: CheckinTicket): string => {
    const info = t.guestInfo ?? {};
    for (const [label, value] of Object.entries(info)) {
      if (classifyInfoLabel(label) === "name" && value) return value;
    }
    return [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
  };
  const tickets = [...summary.tickets].sort((a, b) => {
    const slotCmp = (a.slotStart ?? "~").localeCompare(b.slotStart ?? "~");
    if (slotCmp !== 0) return slotCmp;
    return participantName(a).localeCompare(participantName(b), "de");
  });
  const hasSlots = tickets.some((t) => t.slotStart);

  // Zell-Inhalte pro Ticket vorbereiten (Neopren-Flag + Groesse zusammengefasst).
  const rows = tickets.map((t) => {
    const info = t.guestInfo ?? {};
    let sport = "";
    let level = "";
    let shoe = "";
    let neoprenFlag = "";
    let neoprenSize = "";
    const other = new Map<string, string>();
    for (const [label, value] of Object.entries(info)) {
      if (!value) continue;
      switch (classifyInfoLabel(label)) {
        case "name": break;
        case "sport": sport = value; break;
        case "level": level = value; break;
        case "shoe": shoe = value; break;
        case "neoprenFlag": neoprenFlag = value; break;
        case "neoprenSize": neoprenSize = value; break;
        default: other.set(label, value);
      }
    }
    const neopren = neoprenFlag
      ? isYes(neoprenFlag) ? (neoprenSize || "Ja") : "–"
      : neoprenSize;
    return { ticket: t, sport, level, shoe, neopren, other };
  });

  // Dynamische Zusatz-Spalten aus den "other"-Labels (in Erst-Auftritt-Reihenfolge).
  const otherLabels: string[] = [];
  for (const r of rows) {
    for (const label of r.other.keys()) {
      if (!otherLabels.includes(label)) otherLabels.push(label);
    }
  }

  interface Col { header: string; width: number; value: (r: (typeof rows)[number]) => string }
  const cols: Col[] = [];
  cols.push({ header: "Teilnehmer", width: 0, value: (r) => participantName(r.ticket) });
  if (hasSlots) cols.push({ header: "Slot", width: 18, value: (r) => r.ticket.slotStart ?? "" });
  cols.push({ header: "Sport", width: 24, value: (r) => r.sport });
  cols.push({ header: "Level", width: 28, value: (r) => r.level });
  cols.push({ header: "Schuhgr.", width: 22, value: (r) => r.shoe });
  cols.push({ header: "Neopren", width: 20, value: (r) => r.neopren });
  for (const label of otherLabels) {
    cols.push({ header: label, width: 24, value: (r) => r.other.get(label) ?? "" });
  }
  // Checkbox-Spalte zum Abhaken bei der Material-Ausgabe.
  const checkboxW = 12;
  const fixedW = cols.reduce((sum, c) => sum + c.width, 0) + checkboxW;
  // Teilnehmer-Spalte bekommt den Rest der Breite.
  cols[0].width = Math.max(35, contentW - fixedW);

  const rowH = 8;
  const drawTableHeader = () => {
    fill(PDF_SLATE_900);
    doc.roundedRect(margin, y, contentW, rowH, 1.5, 1.5, "F");
    // Untere Ecken des Header-Bands eckig machen (Rechteck drueberlegen).
    doc.rect(margin, y + rowH / 2, contentW, rowH / 2, "F");
    color(PDF_WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    let x = margin + 2.5;
    for (const c of cols) {
      doc.text(c.header.toUpperCase(), x, y + 5.2, { maxWidth: c.width - 3, charSpace: 0.2 });
      x += c.width;
    }
    doc.text("OK", x + 2.5, y + 5.2, { charSpace: 0.2 });
    y += rowH;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
  };

  drawTableHeader();
  let zebra = false;
  for (const r of rows) {
    if (y + rowH > pageH - 16) {
      doc.addPage();
      y = 18;
      drawTableHeader();
      zebra = false;
    }
    // Zebra-Streifen fuer bessere Zeilen-Lesbarkeit.
    if (zebra) {
      fill(PDF_SLATE_50);
      doc.rect(margin, y, contentW, rowH, "F");
    }
    zebra = !zebra;
    stroke(PDF_SLATE_200);
    doc.setLineWidth(0.2);
    doc.line(margin, y + rowH, margin + contentW, y + rowH);
    let x = margin + 2.5;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const text = doc.splitTextToSize(c.value(r), c.width - 3)[0] ?? "";
      if (i === 0) {
        // Teilnehmername fett und dunkel, Rest dezenter.
        color(PDF_SLATE_900);
        doc.setFont("helvetica", "bold");
      } else {
        color(PDF_SLATE_600);
        doc.setFont("helvetica", "normal");
      }
      doc.text(text, x, y + 5.3);
      x += c.width;
    }
    // Checkbox zum Abhaken bei der Material-Ausgabe.
    stroke(PDF_SLATE_400);
    doc.setLineWidth(0.35);
    doc.roundedRect(x + 2, y + 1.9, 4.2, 4.2, 1, 1, "S");
    y += rowH;
  }

  // ---- Fusszeile auf jeder Seite --------------------------------------------
  const stamp = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    stroke(PDF_SLATE_200);
    doc.setLineWidth(0.3);
    doc.line(margin, pageH - 11, pageW - margin, pageH - 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    color(PDF_SLATE_400);
    doc.text(`${groupName} · ${dateLabel} · erstellt ${stamp}`, margin, pageH - 6.5);
    doc.text(`Seite ${p}/${pageCount}`, pageW - margin, pageH - 6.5, { align: "right" });
  }

  // Im neuen Tab oeffnen (Ansehen/Drucken/Speichern); Fallback: Download.
  const slug = groupName.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-").replace(/^-|-$/g, "");
  const filename = `tagesuebersicht_${slug}_${dateStr}.pdf`;
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, "_blank", "noopener");
  if (!tab) downloadBlob(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/// Erzeugt einen Datei-Slug aus Tickettyp/Code fuer den Download-Fallback.
export function buildPrintFilename(prefix: string, code: string): string {
  const slug = code.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "ticket";
  return `${prefix}_${slug}.pdf`;
}

export async function printTicket(ticket: CheckinTicket, accountName: string): Promise<PrintResult> {
  const [{ jsPDF }, { default: QRCode }] = await Promise.all([import("jspdf"), import("qrcode")]);
  const code = ticket.barcode || ticket.qrCode || ticket.uuid || String(ticket.id);
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(code, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch { /* ignore */ }

  const name = personName(ticket);
  const type = ticket.ticketTypeName ?? ticket.service?.name ?? ticket.subscription?.name ?? "";
  const time = ticket.slotStart && ticket.slotEnd ? `${ticket.slotStart} – ${ticket.slotEnd} Uhr` : "";
  const area = ticket.accessArea?.name ?? "";
  const dateStr = ticket.startDate
    ? new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";
  const validity = ticket.startDate
    ? ticket.endDate
      ? `${dateStr} – ${new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}`
      : dateStr
    : "";
  const extras = ((ticket.extras ?? []) as TicketExtra[])
    .map((ex) => (ex.quantity > 1 ? `${ex.quantity}x ${ex.name}` : ex.name));

  const pw = 72;
  const margin = 4;
  const contentW = pw - margin * 2;
  const doc = new jsPDF({ unit: "mm", format: [pw, 200] });

  let y = 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(accountName, pw / 2, y, { align: "center" });
  y += 5;

  doc.setDrawColor(0);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const nameLines = doc.splitTextToSize(name, contentW);
  doc.text(nameLines, margin, y);
  y += nameLines.length * 4.5;

  doc.setFontSize(9);
  if (type) {
    doc.setFont("helvetica", "bold");
    const typeLines = doc.splitTextToSize(type, contentW);
    doc.text(typeLines, margin, y);
    y += typeLines.length * 3.5;
  }

  doc.setFont("helvetica", "normal");
  if (time) { doc.text(time, margin, y); y += 3.5; }
  if (area) { doc.text(`Bereich: ${area}`, margin, y); y += 3.5; }
  if (validity) { doc.text(`Gültig: ${validity}`, margin, y); y += 3.5; }

  if (extras.length > 0) {
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Extras:", margin, y);
    y += 3;
    doc.setFont("helvetica", "normal");
    for (const ex of extras) {
      const exLines = doc.splitTextToSize(`• ${ex}`, contentW);
      doc.text(exLines, margin, y);
      y += exLines.length * 3;
    }
  }

  y += 2;
  doc.line(margin, y, pw - margin, y);
  y += 3;

  if (qrDataUrl) {
    const qrSize = 38;
    const qrX = (pw - qrSize) / 2;
    doc.addImage(qrDataUrl, "PNG", qrX, y, qrSize, qrSize);
    y += qrSize + 2;
  }

  doc.setFont("courier", "normal");
  doc.setFontSize(7);
  doc.text(code, pw / 2, y, { align: "center" });
  y += 4;

  doc.line(margin, y, pw - margin, y);
  y += 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  doc.text(now, pw / 2, y, { align: "center" });
  y += 8;

  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);

  const blob = doc.output("blob");
  return printPdfBlob(blob, buildPrintFilename("ticket", code));
}

export async function printVoucher(
  voucherCode: string,
  ticketTypeName: string | null,
  accountName: string,
): Promise<PrintResult> {
  const [{ jsPDF }, { default: QRCode }] = await Promise.all([import("jspdf"), import("qrcode")]);
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(voucherCode, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch { /* ignore */ }

  const pw = 72;
  const margin = 4;
  const contentW = pw - margin * 2;
  const doc = new jsPDF({ unit: "mm", format: [pw, 160] });

  let y = 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(accountName, pw / 2, y, { align: "center" });
  y += 5;

  doc.setDrawColor(0);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("GUTSCHEIN", pw / 2, y, { align: "center" });
  y += 6;

  if (ticketTypeName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const typeLines = doc.splitTextToSize(ticketTypeName, contentW);
    doc.text(typeLines, pw / 2, y, { align: "center" });
    y += typeLines.length * 4;
  }

  y += 2;
  doc.line(margin, y, pw - margin, y);
  y += 3;

  if (qrDataUrl) {
    const qrSize = 38;
    const qrX = (pw - qrSize) / 2;
    doc.addImage(qrDataUrl, "PNG", qrX, y, qrSize, qrSize);
    y += qrSize + 2;
  }

  doc.setFont("courier", "bold");
  doc.setFontSize(10);
  doc.text(voucherCode, pw / 2, y, { align: "center" });
  y += 5;

  doc.line(margin, y, pw - margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Einmalig einlösbar. Beim Scannen wird", pw / 2, y, { align: "center" });
  y += 3;
  doc.text("ein Tagesticket erstellt.", pw / 2, y, { align: "center" });
  y += 4;

  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  doc.text(`Erstellt: ${now}`, pw / 2, y, { align: "center" });
  y += 8;

  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);

  const blob = doc.output("blob");
  return printPdfBlob(blob, buildPrintFilename("gutschein", voucherCode));
}
