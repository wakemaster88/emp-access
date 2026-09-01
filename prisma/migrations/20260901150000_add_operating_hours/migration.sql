-- Betriebszeiten: Profil -> Saison -> Oeffnungsperiode je Wochentag, plus
-- Ausnahmetage. Raeume bekommen ein Profil, damit Automationen "waehrend der
-- Betriebszeit" und "bei Betriebsbeginn" auswerten koennen.

-- ── OperatingSchedule ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OperatingSchedule" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperatingSchedule_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "OperatingSchedule_accountId_idx" ON "OperatingSchedule"("accountId");

-- ── OperatingSeason ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OperatingSeason" (
  "id" SERIAL PRIMARY KEY,
  "scheduleId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "startMmDd" TEXT NOT NULL,
  "endMmDd" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OperatingSeason_scheduleId_fkey" FOREIGN KEY ("scheduleId")
    REFERENCES "OperatingSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "OperatingSeason_scheduleId_idx" ON "OperatingSeason"("scheduleId");

-- ── OperatingPeriod ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OperatingPeriod" (
  "id" SERIAL PRIMARY KEY,
  "seasonId" INTEGER NOT NULL,
  "weekday" INTEGER NOT NULL,
  "opensAt" TEXT NOT NULL,
  "closesAt" TEXT NOT NULL,
  CONSTRAINT "OperatingPeriod_seasonId_fkey" FOREIGN KEY ("seasonId")
    REFERENCES "OperatingSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "OperatingPeriod_seasonId_idx" ON "OperatingPeriod"("seasonId");
CREATE INDEX IF NOT EXISTS "OperatingPeriod_seasonId_weekday_idx" ON "OperatingPeriod"("seasonId", "weekday");

-- ── OperatingException ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OperatingException" (
  "id" SERIAL PRIMARY KEY,
  "scheduleId" INTEGER NOT NULL,
  "date" TEXT NOT NULL,
  "closed" BOOLEAN NOT NULL DEFAULT true,
  "opensAt" TEXT,
  "closesAt" TEXT,
  "note" TEXT,
  CONSTRAINT "OperatingException_scheduleId_fkey" FOREIGN KEY ("scheduleId")
    REFERENCES "OperatingSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "OperatingException_scheduleId_date_key"
  ON "OperatingException"("scheduleId", "date");
CREATE INDEX IF NOT EXISTS "OperatingException_scheduleId_idx" ON "OperatingException"("scheduleId");

-- ── Raum bekommt eine Betriebszeit ───────────────────────────────────────────
ALTER TABLE "KeyRoom" ADD COLUMN IF NOT EXISTS "operatingScheduleId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'KeyRoom_operatingScheduleId_fkey'
  ) THEN
    ALTER TABLE "KeyRoom" ADD CONSTRAINT "KeyRoom_operatingScheduleId_fkey"
      FOREIGN KEY ("operatingScheduleId") REFERENCES "OperatingSchedule"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "KeyRoom_operatingScheduleId_idx" ON "KeyRoom"("operatingScheduleId");

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Nur das Profil traegt den Mandanten; Saison, Periode und Ausnahmetag haengen
-- per Cascade daran und werden ausschliesslich ueber das Profil abgefragt.
ALTER TABLE "OperatingSchedule" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'OperatingSchedule' AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "OperatingSchedule" FOR ALL USING ("accountId" = current_setting(''app.current_tenant_id'', TRUE)::int)';
  END IF;
END $$;
