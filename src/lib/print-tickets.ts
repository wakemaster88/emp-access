import { jsPDF } from "jspdf";
import QRCode from "qrcode";

/**
 * Druckhilfen fuer den 72mm-Bondrucker (z. B. Epson TM-m30/M30).
 *
 * Wichtigste Eigenschaften der Implementierung:
 *  - Jedes Ticket bekommt im PDF eine eigene, exakt passende Page-Hoehe.
 *    Damit erkennt der Bondrucker-Treiber jeden Bon als eigene Page und
 *    schneidet zwischen den Bons (sofern "Cut between pages" im Treiber
 *    aktiv ist – Standardeinstellung beim TM-m30/M30).
 *  - QR-Codes werden einmal generiert und beim Dry-Run + echten Render
 *    wiederverwendet (kein doppelter CPU-Aufwand).
 *  - `printTicketsBulk` druckt per Default ein einziges PDF mit N Pages.
 *    Mit `mode: "perTicket"` werden N einzelne PDFs sequentiell gedruckt
 *    – jeder Druckjob endet beim Treiber mit Cut-Kommando, also wird
 *    auch dann zwischen den Bons geschnitten, wenn der Treiber
 *    "End-of-Document"-Cut konfiguriert hat.
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
    const qrSize = 30.4;
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
 * Jede Page hat die individuell auf den Inhalt zugeschnittene Hoehe
 * (mind. MIN_PAGE_HEIGHT_MM, plus Sicherheitspuffer). Damit kann der
 * Bondrucker-Treiber jede Page als eigenen Bon erkennen.
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

  // Pass 1: Dry-Run pro Ticket. Wir messen jede Page individuell, damit
  // sie im finalen PDF exakt so hoch ist, wie das Ticket benoetigt.
  const measureDoc = new jsPDF({ unit: "mm", format: [PAPER_WIDTH_MM, 250] });
  const ticketHeights: number[] = [];
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
    ticketHeights.push(
      Math.max(MIN_PAGE_HEIGHT_MM, Math.ceil(usedY + SAFETY_PADDING_MM)),
    );
  }

  // Pass 2: echtes PDF mit individueller Page-Hoehe pro Bon
  const doc = new jsPDF({ unit: "mm", format: [PAPER_WIDTH_MM, ticketHeights[0]] });
  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage([PAPER_WIDTH_MM, ticketHeights[i]]);
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

/**
 * Tracking aller aktiven Print-Iframes, damit beim naechsten Druck-Versuch
 * verbleibende iframes aus vorherigen Druckaufruf-Iterationen entfernt
 * werden koennen. Andernfalls akkumulieren sie sich (jeweils 30s im DOM)
 * und Chrome blockt parallele `print()`-Calls silent – das ist die
 * Hauptursache fuer "zweiter Klick zeigt keinen Fehler aber druckt auch
 * nicht".
 */
const activePrintIframes = new Map<HTMLIFrameElement, number>();

/**
 * Mindestalter (ms), bevor ein Print-Iframe entfernt werden darf.
 *
 * Ein zu frueh entferntes Iframe reisst dem Windows-Druck-Spooler die
 * PDF-Quelle weg, BEVOR der Job vollstaendig eingelesen wurde – das ist
 * beim Bulk-Druck (perTicket) die Hauptursache fuer "bricht nach x Bons
 * ab" bzw. die OS-Meldung "Fehler beim Drucken". Wir lassen jedes Iframe
 * daher lange genug stehen, damit auch ein langsamer Bondrucker-Spooler
 * den Job sicher uebernommen hat.
 */
const MIN_IFRAME_AGE_MS = 8_000;

function cleanupOldPrintIframes() {
  const now = Date.now();
  for (const [old, createdAt] of activePrintIframes) {
    // Nur Iframes entfernen, deren Druckjob garantiert schon gespoolt ist.
    // Juengere Iframes (= laufender/frischer Job) bleiben unangetastet.
    if (now - createdAt < MIN_IFRAME_AGE_MS) continue;
    try {
      old.remove();
    } catch {
      /* already removed */
    }
    activePrintIframes.delete(old);
  }
}

/** Versucht das PDF in einem versteckten iframe zu drucken. */
export function tryIframePrint(blobUrl: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Vorherige Print-Iframes aus dem DOM raeumen, sonst kollidiert das
    // neue print() mit hängenden Resourcen.
    cleanupOldPrintIframes();

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    activePrintIframes.set(iframe, Date.now());

    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      // Iframe noch ~20s im DOM lassen, damit der Druckdialog Zeit zum
      // Oeffnen hat. Aufraeumen passiert spaetestens beim naechsten Druck
      // ueber `cleanupOldPrintIframes`.
      setTimeout(() => {
        try {
          iframe.remove();
        } catch {
          /* already removed */
        }
        activePrintIframes.delete(iframe);
      }, 20_000);
      resolve({ ok, error });
    };

    iframe.onload = () => {
      // requestAnimationFrame zweimal = ~32ms Wartezeit, kurz genug um die
      // Browser-User-Activation nicht zu verlieren, lang genug damit der
      // PDF-Viewer initial gerendert hat.
      const triggerPrint = () => {
        try {
          // Beide Focus-Varianten: einige Browser brauchen das
          // iframe-Element selbst, andere das contentWindow.
          iframe.focus();
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          finish(true);
        } catch (e) {
          finish(false, e instanceof Error ? e.message : String(e));
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(triggerPrint));
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

function buildFilename(count: number, index?: number): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "_")
    .replace(/:/g, "");
  if (index != null) {
    return `ticket_${index}_${stamp}.pdf`;
  }
  return `tickets_${count}_${stamp}.pdf`;
}

/**
 * Generischer Print-Pipeline-Helper: nimmt ein bereits gerendertes PDF-Blob
 * und feuert es durch die robuste iframe -> newTab -> download Kette.
 *
 * Wichtig: Wir drucken IMMER direkt das PDF-Document (iframe.contentWindow.
 * print() bzw. nativer PDF-Viewer im neuen Tab). NIEMALS einen HTML-Wrapper
 * mit eingebettetem `<embed>`-PDF + `window.print()` -- das druckt das
 * HTML-Dokument im Default-A4-Format, der Bondrucker-Treiber lehnt das ab.
 * Das im PDF eingebackene 72-mm-Format aus `buildTicketsPdfBlob` muss bis
 * zum Drucker durchkommen.
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

export type PrintMode = "combined" | "perTicket";

export interface PrintBulkOptions {
  /**
   * `combined` (Default): ein einziges PDF mit N Pages, ein Druckjob.
   *   Schneller, aber Cutter haengt vom Treiber-Setting ab.
   *   Falls der Treiber nur "Cut at end of document" macht, wird das
   *   gesamte Bulk als ein langer Streifen ausgeworfen.
   *
   * `perTicket`: pro Ticket ein eigenes PDF + eigener Druckjob,
   *   sequentiell. Jeder Druckjob endet beim Treiber mit dem
   *   Cut-Befehl, also wird auch dann sicher zwischen den Bons
   *   geschnitten, wenn der Treiber als "Document Cut" konfiguriert
   *   ist. Trade-off: Browser zeigt pro Druckjob einen Druckdialog
   *   (Chrome merkt sich nach dem ersten Klick die Auswahl in der
   *   Regel; bei vielen Tickets bitte ggf. Kiosk-Druckmodus nutzen).
   */
  mode?: PrintMode;
}

/**
 * Erzeugt die Tickets-PDF und triggert den Druckdialog. Bei Fehlern wird
 * automatisch auf "neuer Tab" und – falls Popup geblockt – auf Download
 * zurueckgefallen.
 */
export async function printTicketsBulk(
  tickets: PrintableTicket[],
  accountName: string,
  options: PrintBulkOptions = {},
): Promise<PrintResult> {
  if (tickets.length === 0) {
    return { ok: false, transport: "iframe", error: "Keine Tickets zum Drucken." };
  }

  const mode: PrintMode = options.mode ?? "combined";

  if (mode === "perTicket" && tickets.length > 1) {
    // Sequentiell: Pro Ticket ein PDF + ein Druckjob. Wir warten zwischen
    // den Jobs minimal, damit der Treiber den vorherigen Job abschliessen
    // kann (sonst kann es passieren, dass der Browser zwei iframes
    // gleichzeitig druckt und Jobs ineinander rutschen).
    let lastResult: PrintResult = { ok: false, transport: "iframe" };
    for (let i = 0; i < tickets.length; i++) {
      const blob = await buildTicketsPdfBlob([tickets[i]], accountName);
      lastResult = await printPdfBlob(blob, buildFilename(1, i + 1));
      if (!lastResult.ok && lastResult.transport === "download") {
        // Wenn der erste Bon schon nicht direkt gedruckt werden konnte,
        // brechen wir ab statt N Downloads zu erzeugen.
        return lastResult;
      }
      if (i < tickets.length - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    return lastResult;
  }

  const blob = await buildTicketsPdfBlob(tickets, accountName);
  return printPdfBlob(blob, buildFilename(tickets.length));
}
