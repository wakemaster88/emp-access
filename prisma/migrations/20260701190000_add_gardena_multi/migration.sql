-- Mehrere GARDENA-Verbindungen pro Mandant:
--  * ApiConfig.name  → optionales Label je Verbindung
--  * Device.gardenaConfigId → Zuordnung Ventil/Pumpe → GARDENA-Verbindung
-- Alle Schritte mit IF NOT EXISTS-Guards, damit wiederholtes `migrate deploy`
-- harmlos bleibt. Bestehende GARDENA-Geraete werden auf die (bisher einzige)
-- GARDENA-Verbindung ihres Accounts zurueck-gemappt.

ALTER TABLE "ApiConfig" ADD COLUMN IF NOT EXISTS "name" TEXT;

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "gardenaConfigId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Device_gardenaConfigId_fkey'
  ) THEN
    ALTER TABLE "Device"
      ADD CONSTRAINT "Device_gardenaConfigId_fkey"
      FOREIGN KEY ("gardenaConfigId") REFERENCES "ApiConfig"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Device_gardenaConfigId_idx" ON "Device"("gardenaConfigId");

-- Backfill: bestehende GARDENA-Geraete der einzigen GARDENA-Verbindung ihres
-- Accounts zuordnen.
UPDATE "Device" d
SET "gardenaConfigId" = ac.id
FROM "ApiConfig" ac
WHERE d."type" = 'GARDENA_VALVE'
  AND d."gardenaConfigId" IS NULL
  AND ac."accountId" = d."accountId"
  AND ac."provider" = 'GARDENA';
