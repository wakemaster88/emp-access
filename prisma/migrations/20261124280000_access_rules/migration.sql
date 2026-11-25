-- Einlass-Regeln als Schalter in den Einstellungen. Beide Spalten sind
-- additiv: NULL bzw. false heißt „Regel aus“, der Scan bleibt wie bisher.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "accessRules" JSONB;
ALTER TABLE "AccessArea" ADD COLUMN IF NOT EXISTS "allowUnassignedTickets" BOOLEAN NOT NULL DEFAULT false;
