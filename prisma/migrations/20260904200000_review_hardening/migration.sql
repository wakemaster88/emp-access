-- Review 2026-09: Passwort-Sperre, Geraete-Token, Telegram-Versandmarke,
-- Bilder/PDFs in den Blob-Speicher (Bytes-Spalten werden optional).

-- Admin: Sperre nach zu vielen falschen Passwoertern
ALTER TABLE "Admin"
  ADD COLUMN "loginFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "loginLockedUntil" TIMESTAMP(3);

-- Device: eigenes Token pro Scanner-/Audio-Pi
ALTER TABLE "Device" ADD COLUMN "apiToken" TEXT;
CREATE UNIQUE INDEX "Device_apiToken_key" ON "Device"("apiToken");

-- TelegramConfig: wann der letzte Tagesbericht rausging
ALTER TABLE "TelegramConfig" ADD COLUMN "dailyReportLastSentAt" TIMESTAMP(3);

-- ScanSnapshot / MonitorAlertImage: Bild optional, Pfad im Blob-Speicher
ALTER TABLE "ScanSnapshot"
  ALTER COLUMN "image" DROP NOT NULL,
  ADD COLUMN "blobPathname" TEXT;
CREATE INDEX "ScanSnapshot_blobPathname_idx" ON "ScanSnapshot"("blobPathname");

ALTER TABLE "MonitorAlertImage"
  ALTER COLUMN "image" DROP NOT NULL,
  ADD COLUMN "blobPathname" TEXT;
CREATE INDEX "MonitorAlertImage_blobPathname_idx" ON "MonitorAlertImage"("blobPathname");

-- Sichtungen: Snapshot im Blob-Speicher
ALTER TABLE "PersonSighting" ADD COLUMN "snapshotBlob" TEXT;
CREATE INDEX "PersonSighting_snapshotBlob_idx" ON "PersonSighting"("snapshotBlob");

ALTER TABLE "VehicleSighting" ADD COLUMN "snapshotBlob" TEXT;
CREATE INDEX "VehicleSighting_snapshotBlob_idx" ON "VehicleSighting"("snapshotBlob");

-- Schluesselprotokoll-PDF im Blob-Speicher
ALTER TABLE "KeySignature" ADD COLUMN "pdfBlob" TEXT;
CREATE INDEX "KeySignature_pdfBlob_idx" ON "KeySignature"("pdfBlob");
