-- Geraet → Kamera Verknuepfung: Kamera, die einen Zugang (z. B. Drehkreuz
-- "Eingang A") im Blick hat. Scans des Geraets werden mit der Kamera verknuepft.
ALTER TABLE "Device" ADD COLUMN "cameraId" INTEGER;

ALTER TABLE "Device" ADD CONSTRAINT "Device_cameraId_fkey"
  FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Device_cameraId_idx" ON "Device"("cameraId");
