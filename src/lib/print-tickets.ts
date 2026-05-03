import { jsPDF } from "jspdf";
import QRCode from "qrcode";

/**
 * Druckhilfen fuer den 72mm-Bondrucker (z. B. Epson TM-m30/M30).
 *
 * Wichtigste Eigenschaften der Implementierung:
 *  - Die Seitenhoehe wird DYNAMISCH aus dem laengsten Ticket berechnet, damit
 *    der Druckertreiber nicht ueberlaufende Inhalte abschneidet (Hauptursache
 *    fuer Treiberfehler beim TM-m30, wenn die Seitenform zu klein ist).
 *  - Alle Seiten haben die SELBE Hoehe – die meisten Bondrucker-Treiber
 *    verlangen konsistente Form-Groessen pro Druckjob.
 *  - QR-Codes werden einmal generiert und beim Dry-Run + echten Render
 *    wiederverwendet (kein doppelter CPU-Aufwand).
 *  - Druck wird ueber ein verstecktes iframe ausgeloest. Bei Fehler oder
 *    geblocktem Druckdialog wird auf "neuer Tab" und im letzten Schritt auf
 *    Download zurueckgefallen, sodass der User immer ans PDF kommt.
 */

export interface PrintableTicket {
  name: string;
  barcode: string;
  ticketTypeName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  accessAreaName?: string | null;
  validityType?: string | null;
  validityDurationMinutes?: number | null;
}

export type PrintTransport = "iframe" | "newTab" | "download";

export interface PrintResult {
  ok: boolean;
  transport: PrintTransport;
  error?: string;
  /** Wenn transport=download: blob-URL, damit der Aufrufer einen Link bauen kann. */
  fallbackUrl?: string;
  fallbackFilename?: string;
}

const PAPER_WIDTH_MM = 72;
const MARGIN_MM = 4;
const MIN_PAGE_HEIGHT_MM = 90;
const SAFETY_PADDING_MM = 6;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Erzeugt QR-Code-DataURL einmal pro Barcode (cache-bar in Maps). */
async function generateQrCode(barcode: string): Promise<string> {
  try {
    return await QRCode.toDataURL(barcode, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return "";
  }
}

/**
 * Zeichnet ein Ticket. Gibt den finalen y-Wert (= benoetigte Hoehe in mm)
 * zurueck. Wenn `qrDataUrl` mit reingegeben wird, wird der QR-Code nicht
 * erneut generiert (Performance fuer Dry-Run + Real-Pass).
 */
function drawTicket(
  doc: jsPDF,
  ticket: PrintableTicket,
  accountName: string,
  index: number,
  total: number,
  qrDataUrl: string,
): number {
  const pw = PAPER_WIDTH_MM;
  const margin = MARGIN_MM;
  const contentW = pw - margin * 2;

  let y = 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(accountName, pw / 2, y, { align: "center" });
  y += 5;

  if (total > 1) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`Bon ${index + 1} / ${total}`, pw / 2, y, { align: "center" });
    doc.setTextColor(0);
    y += 3;
  }

  doc.setDrawColor(0);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const nameLines = doc.splitTextToSize(ticket.name || "—", contentW);
  doc.text(nameLines, margin, y);
  y += nameLines.length * 4.5;

  doc.setFontSize(9);
  if (ticket.ticketTypeName) {
    doc.setFont("helvetica", "bold");
    const typeLines = doc.splitTextToSize(ticket.ticketTypeName, contentW);
    doc.text(typeLines, margin, y);
    y += typeLines.length * 3.5;
  }

  doc.setFont("helvetica", "normal");
  if (ticket.slotStart && ticket.slotEnd) {
    doc.text(`${ticket.slotStart} – ${ticket.slotEnd} Uhr`, margin, y);
    y += 3.5;
  }
  if (ticket.accessAreaName) {
    const areaLines = doc.splitTextToSize(`Bereich: ${ticket.accessAreaName}`, contentW);
    doc.text(areaLines, margin, y);
    y += areaLines.length * 3.5;
  }
  const startStr = fmtDate(ticket.startDate);
  const endStr = fmtDate(ticket.endDate);
  const validity = startStr
    ? endStr && endStr !== startStr
      ? `${startStr} – ${endStr}`
      : startStr
    : "";
  if (validity) {
    doc.text(`Gültig: ${validity}`, margin, y);
    y += 3.5;
  } else if (ticket.validityType === "DURATION" && ticket.validityDurationMinutes) {
    const mins = ticket.validityDurationMinutes;
    const label = mins >= 60 ? `${Math.round((mins / 60) * 10) / 10} h` : `${mins} Min.`;
    doc.text(`Gültigkeit: ${label} ab Erstscan`, margin, y);
    y += 3.5;
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
  doc.setFontSize(8);
  doc.text(ticket.barcode, pw / 2, y, { align: "center" });
  y += 4;

  doc.line(margin, y, pw - margin, y);
  y += 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  doc.text(now, pw / 2, y, { align: "center" });
  y += 5;

  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);

  return y;
}

/**
 * Erzeugt das PDF-Blob fuer die uebergebenen Tickets.
 * Seitenhoehe wird auf den Inhalt des laengsten Tickets ausgelegt
 * (mind. 90mm, plus Sicherheitspuffer).
 */
async function buildTicketsPdfBlob(
  tickets: PrintableTicket[],
  accountName: string,
): Promise<Blob> {
  // QR-Codes vorab erzeugen, damit Dry-Run und Real-Pass denselben benutzen
  const qrCache = new Map<string, string>();
  await Promise.all(
    tickets.map(async (t) => {
      if (!qrCache.has(t.barcode)) {
        qrCache.set(t.barcode, await generateQrCode(t.barcode));
      }
    }),
  );

  // Pass 1: Dry-Run zur Hoehenmessung mit grosszuegiger Default-Hoehe
  const measureDoc = new jsPDF({ unit: "mm", format: [PAPER_WIDTH_MM, 250] });
  let maxHeight = MIN_PAGE_HEIGHT_MM;
  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) measureDoc.addPage([PAPER_WIDTH_MM, 250]);
    const usedY = drawTicket(
      measureDoc,
      tickets[i],
      accountName,
      i,
      tickets.length,
      qrCache.get(tickets[i].barcode) ?? "",
    );
    if (usedY > maxHeight) maxHeight = usedY;
  }
  const pageHeight = Math.max(MIN_PAGE_HEIGHT_MM, Math.ceil(maxHeight + SAFETY_PADDING_MM));

  // Pass 2: echtes PDF mit konsistenter Seitenhoehe pro Bon
  const doc = new jsPDF({ unit: "mm", format: [PAPER_WIDTH_MM, pageHeight] });
  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage([PAPER_WIDTH_MM, pageHeight]);
    drawTicket(
      doc,
      tickets[i],
      accountName,
      i,
      tickets.length,
      qrCache.get(tickets[i].barcode) ?? "",
    );
  }

  return doc.output("blob");
}

/** Versucht das PDF in einem versteckten iframe zu drucken. */
export function tryIframePrint(blobUrl: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";

    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      // Iframe nicht sofort entfernen – manche Druckdialoge brauchen es
      // weiterhin. Cleanup nach 30s.
      setTimeout(() => {
        try {
          iframe.remove();
        } catch {
          /* already removed */
        }
      }, 30_000);
      resolve({ ok, error });
    };

    iframe.onload = () => {
      // Kurz warten bis der PDF-Viewer im iframe wirklich geladen ist –
      // bei Chrome/Edge hilft das gegen "User Activation"-Probleme.
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          // print() ist synchron und blockiert bis der Druckdialog geschlossen wurde.
          iframe.contentWindow?.print();
          finish(true);
        } catch (e) {
          finish(false, e instanceof Error ? e.message : String(e));
        }
      }, 350);
    };

    iframe.onerror = () => finish(false, "iframe konnte nicht geladen werden");

    iframe.src = blobUrl;
    document.body.appendChild(iframe);

    // Globale Sicherung: Falls weder onload noch onerror feuert.
    setTimeout(() => {
      if (!settled) finish(false, "Druckdialog hat nicht geantwortet (Timeout)");
    }, 12_000);
  });
}

/** Loest einen Klassischen Browser-Download fuer das Blob aus. */
export function downloadBlob(blobUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 5_000);
}

function buildFilename(count: number): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "_")
    .replace(/:/g, "");
  return `tickets_${count}_${stamp}.pdf`;
}

/**
 * Generischer Print-Pipeline-Helper: nimmt ein bereits gerendertes PDF-Blob
 * (z. B. von `printTicket` im Public Checkin) und feuert es durch die selbe
 * robuste iframe → newTab → download Kette wie `printTicketsBulk`.
 *
 * Damit verschwindet der Browser-Druckfehler-Dialog, der erscheint wenn
 * `iframe.contentWindow.print()` ohne focus() und vor dem PDF-Load
 * aufgerufen wird (Chrome zeigt dann einen "Fehler beim Drucken"-Toast,
 * obwohl die Testseite an den Drucker kommt).
 */
export async function printPdfBlob(
  blob: Blob,
  filename: string,
): Promise<PrintResult> {
  const url = URL.createObjectURL(blob);

  const printAttempt = await tryIframePrint(url);
  if (printAttempt.ok) {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { ok: true, transport: "iframe" };
  }

  const newTab = typeof window !== "undefined" ? window.open(url, "_blank", "noopener") : null;
  if (newTab) {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { ok: true, transport: "newTab", error: printAttempt.error };
  }

  downloadBlob(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return {
    ok: false,
    transport: "download",
    error: printAttempt.error,
    fallbackUrl: url,
    fallbackFilename: filename,
  };
}

/**
 * Erzeugt die Tickets-PDF und triggert den Druckdialog. Bei Fehlern wird
 * automatisch auf "neuer Tab" und – falls Popup geblockt – auf Download
 * zurueckgefallen.
 */
export async function printTicketsBulk(
  tickets: PrintableTicket[],
  accountName: string,
): Promise<PrintResult> {
  if (tickets.length === 0) {
    return { ok: false, transport: "iframe", error: "Keine Tickets zum Drucken." };
  }

  const blob = await buildTicketsPdfBlob(tickets, accountName);
  return printPdfBlob(blob, buildFilename(tickets.length));
}
