-- Ventil → Pumpe Zuordnung (Self-Relation auf Device): wird ein Ventil
-- aktiviert, schaltet die zugeordnete Pumpe automatisch mit an.
-- IF NOT EXISTS-Guards, damit wiederholtes `migrate deploy` harmlos bleibt.

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "pumpDeviceId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Device_pumpDeviceId_fkey'
  ) THEN
    ALTER TABLE "Device"
      ADD CONSTRAINT "Device_pumpDeviceId_fkey"
      FOREIGN KEY ("pumpDeviceId") REFERENCES "Device"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Device_pumpDeviceId_idx" ON "Device"("pumpDeviceId");
