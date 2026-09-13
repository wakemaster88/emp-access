-- Halteverbot pro Kamera aus der Cloud einstellbar: gesperrte Flaeche als
-- Polygon (normiert) und Standzeit, ab der gemeldet wird. Bisher nur per
-- HUB_NOPARK_CAMERAS / HUB_NOPARK_ZONE_<id> / HUB_NOPARK_MINUTES in hub/.env.
-- Standard aus, damit die Pruefung nicht ungefragt auf allen Kameras laeuft.
ALTER TABLE "Camera"
  ADD COLUMN "noParkDetection" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "noParkZone" JSONB,
  ADD COLUMN "noParkMinutes" DOUBLE PRECISION;
