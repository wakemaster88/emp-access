import { jsPDF } from "jspdf";
import QRCode from "qrcode";

/**
 * Druckhilfen fuer den 72mm-Bondrucker.
 * Das Format orientiert sich am bestehenden Checkin-Druck und produziert
 * eine PDF, die im Browser direkt in den Druckdialog geschickt wird.
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

const PAPER_WIDTH_MM = 72;
const MARGIN_MM = 4;
const PAGE_HEIGHT_MM = 110;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function drawTicket(
  doc: jsPDF,
  ticket: PrintableTicket,
  accountName: string,
  index: number,
  total: number,
) {
  const pw = PAPER_WIDTH_MM;
  const margin = MARGIN_MM;
  const contentW = pw - margin * 2;

  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(ticket.barcode, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    /* ignore */
  }

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
  const nameLines = doc.splitTextToSize(ticket.name, contentW);
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
    doc.text(`Bereich: ${ticket.accessAreaName}`, margin, y);
    y += 3.5;
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
}

/**
 * Erzeugt eine Multi-Page-Bondrucker-PDF (eine Seite pro Ticket) und
 * triggert den nativen Browser-Druckdialog ueber ein verstecktes iframe.
 */
export async function printTicketsBulk(
  tickets: PrintableTicket[],
  accountName: string,
): Promise<void> {
  if (tickets.length === 0) return;

  const doc = new jsPDF({
    unit: "mm",
    format: [PAPER_WIDTH_MM, PAGE_HEIGHT_MM],
  });

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage([PAPER_WIDTH_MM, PAGE_HEIGHT_MM]);
    await drawTicket(doc, tickets[i], accountName, i, tickets.length);
  }

  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        /* already removed */
      }
      URL.revokeObjectURL(url);
    }, 8000);
  };
}
