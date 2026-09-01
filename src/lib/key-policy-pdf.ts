import { jsPDF } from "jspdf";

/**
 * Rendert das unterschriebene Schluesselprotokoll als A4-PDF.
 *
 * Gezeichnet wird ausschliesslich aus dem Snapshot, der beim Erzeugen des
 * Signatur-Links eingefroren wurde. Spaetere Aenderungen an Vorlage,
 * Schluesseln oder Empfaenger duerfen ein bereits unterschriebenes Dokument
 * nicht mehr veraendern.
 */

export interface PolicySnapshot {
  templateName: string;
  version: number;
  bodyText: string;
  liabilityText?: string | null;
}

export interface KeySnapshotEntry {
  keyNumber: string;
  label?: string | null;
  levelLabel: string;
  locks: string[];
}

export interface KeySnapshot {
  holderName: string;
  holderCompany?: string | null;
  holderEmail?: string | null;
  handoverId: number;
  issuedAt: string;
  dueAt?: string | null;
  deposit?: number | null;
  issuedByName?: string | null;
  keys: KeySnapshotEntry[];
}

export interface SignedDocument {
  accountName: string;
  kind: "HANDOVER" | "RETURN";
  policy: PolicySnapshot;
  keys: KeySnapshot;
  signedName: string;
  signedAt: string;
  signatureImage: string | null;
  signerIp?: string | null;
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function buildKeyProtocolPdf(doc: SignedDocument): ArrayBuffer {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed <= PAGE_H - MARGIN) return;
    pdf.addPage();
    y = MARGIN;
  };

  const paragraph = (text: string, size = 10, lineHeight = 4.6) => {
    pdf.setFontSize(size);
    for (const line of pdf.splitTextToSize(text, CONTENT_W) as string[]) {
      newPageIfNeeded(lineHeight);
      pdf.text(line, MARGIN, y);
      y += lineHeight;
    }
  };

  const heading = (text: string) => {
    newPageIfNeeded(12);
    y += 3;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(text, MARGIN, y);
    pdf.setFont("helvetica", "normal");
    y += 6;
  };

  // Kopf
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(
    doc.kind === "RETURN" ? "Schlüsselrückgabe" : "Schlüsselübergabe",
    MARGIN,
    y,
  );
  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`${doc.accountName} · Protokoll Nr. ${doc.keys.handoverId}`, MARGIN, y);
  y += 5;
  pdf.setDrawColor(180);
  pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;

  // Stammdaten
  const facts: [string, string][] = [
    ["Empfänger", doc.keys.holderName],
    ["Firma", doc.keys.holderCompany || "–"],
    ["E-Mail", doc.keys.holderEmail || "–"],
    ["Ausgabe am", fmtDateTime(doc.keys.issuedAt)],
    ["Rückgabe bis", fmtDate(doc.keys.dueAt)],
    ["Pfand", doc.keys.deposit != null ? `${doc.keys.deposit.toFixed(2)} EUR` : "–"],
    ["Ausgegeben von", doc.keys.issuedByName || "–"],
  ];
  pdf.setFontSize(10);
  for (const [label, value] of facts) {
    newPageIfNeeded(5.2);
    pdf.setTextColor(110);
    pdf.text(`${label}:`, MARGIN, y);
    pdf.setTextColor(0);
    pdf.text(String(value), MARGIN + 36, y);
    y += 5.2;
  }

  // Schlüsselliste
  heading("Übergebene Schlüssel");
  pdf.setFontSize(9);
  for (const key of doc.keys.keys) {
    newPageIfNeeded(10);
    pdf.setFont("helvetica", "bold");
    pdf.text(`${key.keyNumber}`, MARGIN, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(
      [key.label, key.levelLabel].filter(Boolean).join(" · "),
      MARGIN + 34,
      y,
    );
    y += 4.4;
    const locks = key.locks.length ? key.locks.join(", ") : "keine Schlösser zugeordnet";
    pdf.setTextColor(110);
    for (const line of pdf.splitTextToSize(`Schließt: ${locks}`, CONTENT_W - 6) as string[]) {
      newPageIfNeeded(4);
      pdf.text(line, MARGIN + 6, y);
      y += 4;
    }
    pdf.setTextColor(0);
    y += 1.5;
  }

  // Belehrung
  heading(`Belehrung – ${doc.policy.templateName} (Version ${doc.policy.version})`);
  paragraph(doc.policy.bodyText, 9.5);

  if (doc.policy.liabilityText?.trim()) {
    heading("Haftungserklärung");
    paragraph(doc.policy.liabilityText, 9.5);
  }

  // Unterschrift
  newPageIfNeeded(48);
  y += 6;
  pdf.setDrawColor(180);
  pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Digital signiert", MARGIN, y);
  pdf.setFont("helvetica", "normal");
  y += 6;

  if (doc.signatureImage) {
    try {
      pdf.addImage(doc.signatureImage, "PNG", MARGIN, y, 70, 26);
    } catch {
      // Kaputtes Bild darf das Dokument nicht verhindern.
    }
  }
  y += 28;
  pdf.setDrawColor(120);
  pdf.line(MARGIN, y, MARGIN + 70, y);
  y += 4.5;
  pdf.setFontSize(9);
  pdf.text(doc.signedName, MARGIN, y);
  y += 4.5;
  pdf.setTextColor(110);
  pdf.text(`Signiert am ${fmtDateTime(doc.signedAt)}`, MARGIN, y);
  y += 4.5;
  if (doc.signerIp) {
    pdf.text(`IP-Adresse: ${doc.signerIp}`, MARGIN, y);
  }

  return pdf.output("arraybuffer");
}
