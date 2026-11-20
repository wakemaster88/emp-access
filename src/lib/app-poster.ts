/**
 * A4-Aushang mit QR-Code zur Kunden-App (jspdf und qrcode werden erst beim
 * Drucken geladen). Farben nach der App-CI (siehe docs/projektwissen/funktionen.md).
 */
import { printPdfBlob, type PrintResult } from "@/lib/print-tickets";

const PETROL: [number, number, number] = [26, 109, 115];
const INK: [number, number, number] = [18, 26, 28];
const SOFT: [number, number, number] = [90, 104, 108];

export async function printAppPoster(url: string, accountName: string): Promise<PrintResult> {
  const [{ jsPDF }, qr] = await Promise.all([import("jspdf"), import("qrcode")]);
  const qrData = await qr.default.toDataURL(url, { width: 600, margin: 1, errorCorrectionLevel: "M" });

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageW = 210;
  const center = pageW / 2;

  doc.setFillColor(PETROL[0], PETROL[1], PETROL[2]);
  doc.rect(0, 0, pageW, 52, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.text("Unsere Kunden App", center, 28, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  if (accountName) doc.text(accountName, center, 41, { align: "center" });

  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Code mit der Handy-Kamera scannen", center, 74, { align: "center" });

  const size = 120;
  doc.addImage(qrData, "PNG", center - size / 2, 84, size, size, undefined, "FAST");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.setTextColor(SOFT[0], SOFT[1], SOFT[2]);
  const lines = doc.splitTextToSize(
    "Besuchstage, Starts, Meilensteine und deine Gutscheine immer dabei. Einmal anmelden, danach öffnet sich die App direkt.",
    160,
  );
  doc.text(lines, center, 220, { align: "center" });

  doc.setFontSize(12);
  const install = doc.splitTextToSize(
    "Als App installieren: im Browser über „Teilen“ bzw. das Menü „Zum Home-Bildschirm“ wählen.",
    160,
  );
  doc.text(install, center, 244, { align: "center" });

  doc.setTextColor(PETROL[0], PETROL[1], PETROL[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(url.replace(/^https?:\/\//, ""), center, 270, { align: "center" });

  return printPdfBlob(doc.output("blob"), "kunden-app-aushang.pdf");
}
