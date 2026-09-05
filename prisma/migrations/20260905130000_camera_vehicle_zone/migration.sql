-- Fahrzeug-Fallback pro Kamera aus der Cloud einstellbar: Mindestgroesse der
-- Fahrzeug-Box (Anteil Bildflaeche) und Einfahrtszone (Polygon, normiert).
-- Bisher nur per HUB_VEHICLE_MIN_AREA / HUB_VEHICLE_ZONE_<id> in hub/.env.
ALTER TABLE "Camera"
  ADD COLUMN "vehicleMinArea" DOUBLE PRECISION,
  ADD COLUMN "vehicleZone" JSONB;
