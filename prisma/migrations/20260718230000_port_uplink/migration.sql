-- Uplink-/Zuleitungs-Kennzeichen fuer Switch-Ports (gesonderte Darstellung
-- in der Port-Matrix).

ALTER TABLE "NetworkPort" ADD COLUMN IF NOT EXISTS "uplink" BOOLEAN NOT NULL DEFAULT false;
