-- Bewaesserungs-Laufhistorie (Ventil, Dauer, Quelle) fuer die Statistik.
-- IF NOT EXISTS-Guards, damit wiederholtes `migrate deploy` harmlos bleibt.

CREATE TABLE IF NOT EXISTS "IrrigationRun" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "deviceId" INTEGER NOT NULL,
  "scheduleId" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "durationMinutes" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "litersEstimate" DOUBLE PRECISION,
  CONSTRAINT "IrrigationRun_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IrrigationRun_deviceId_fkey" FOREIGN KEY ("deviceId")
    REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IrrigationRun_scheduleId_fkey" FOREIGN KEY ("scheduleId")
    REFERENCES "IrrigationSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "IrrigationRun_accountId_startedAt_idx"
  ON "IrrigationRun"("accountId", "startedAt");
CREATE INDEX IF NOT EXISTS "IrrigationRun_deviceId_startedAt_idx"
  ON "IrrigationRun"("deviceId", "startedAt");
CREATE INDEX IF NOT EXISTS "IrrigationRun_scheduleId_idx"
  ON "IrrigationRun"("scheduleId");

ALTER TABLE "IrrigationRun" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'IrrigationRun' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "IrrigationRun"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
