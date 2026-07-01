-- Bewässerungs-Zeitpläne fuer GARDENA-Ventile/Pumpen. Tenant-scoped mit RLS
-- (gleiches Muster wie die Email-Tabellen). IF NOT EXISTS-Guards, damit ein
-- wiederholtes `migrate deploy` harmlos bleibt.

CREATE TABLE IF NOT EXISTS "IrrigationSchedule" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "deviceId" INTEGER NOT NULL,
  "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
  "startTime" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL DEFAULT 15,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "skipOnRain" BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IrrigationSchedule_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IrrigationSchedule_deviceId_fkey" FOREIGN KEY ("deviceId")
    REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "IrrigationSchedule_accountId_isActive_idx"
  ON "IrrigationSchedule"("accountId", "isActive");
CREATE INDEX IF NOT EXISTS "IrrigationSchedule_deviceId_idx"
  ON "IrrigationSchedule"("deviceId");

ALTER TABLE "IrrigationSchedule" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'IrrigationSchedule' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "IrrigationSchedule"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
