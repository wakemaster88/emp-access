-- Regeln für Links und Monitore als Schalter in den Einstellungen. Die
-- Schalter liegen in "Account"."accessRules" (JSON, schon vorhanden). Die
-- Spalten sind additiv: false bzw. NULL heißt „wie bisher“.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "mobileEmergencyGrant" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalMaxOpenBookings" INTEGER;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalMaxInclusivePerMonth" INTEGER;
