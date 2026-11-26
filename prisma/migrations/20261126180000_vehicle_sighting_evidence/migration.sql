-- Halteverbot: Ausschnitt um das Fahrzeug in voller Auflösung, den der Hub
-- zur ersten Meldung nachreicht (POST /api/hub/parking-violations/evidence).
-- Rein additiv und nullable: Bestehende Sichtungen und ältere Hubs haben
-- keinen Ausschnitt.
ALTER TABLE "VehicleSighting" ADD COLUMN IF NOT EXISTS "evidence" BYTEA;
ALTER TABLE "VehicleSighting" ADD COLUMN IF NOT EXISTS "evidenceBlob" TEXT;
