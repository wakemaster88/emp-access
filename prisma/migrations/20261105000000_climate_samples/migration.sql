-- Klimaverlauf: Temperatur und Luftfeuchte je Fuehler in 5-Minuten-, Stunden- und Tagesfenstern.
DO $$ BEGIN
  CREATE TYPE "ClimateResolution" AS ENUM ('MIN5', 'HOUR', 'DAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ClimateSample" (
  "id"          SERIAL PRIMARY KEY,
  "accountId"   INTEGER NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "deviceId"    INTEGER NOT NULL REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "roomId"      INTEGER REFERENCES "KeyRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "resolution"  "ClimateResolution" NOT NULL,
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "tempMin"     DOUBLE PRECISION,
  "tempAvg"     DOUBLE PRECISION,
  "tempMax"     DOUBLE PRECISION,
  "humMin"      DOUBLE PRECISION,
  "humAvg"      DOUBLE PRECISION,
  "humMax"      DOUBLE PRECISION,
  "count"       INTEGER NOT NULL DEFAULT 1,
  "source"      TEXT NOT NULL DEFAULT 'hub'
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClimateSample_deviceId_resolution_bucketStart_key"
  ON "ClimateSample"("deviceId", "resolution", "bucketStart");
CREATE INDEX IF NOT EXISTS "ClimateSample_accountId_roomId_resolution_bucketStart_idx"
  ON "ClimateSample"("accountId", "roomId", "resolution", "bucketStart");
CREATE INDEX IF NOT EXISTS "ClimateSample_accountId_resolution_bucketStart_idx"
  ON "ClimateSample"("accountId", "resolution", "bucketStart");

-- Row Level Security
ALTER TABLE "ClimateSample" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ClimateSample' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "ClimateSample"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
