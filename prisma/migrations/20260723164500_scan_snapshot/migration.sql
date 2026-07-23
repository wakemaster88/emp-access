-- Scan-Schnappschuss: Kamerabild zum Scan-Zeitpunkt. Der Hub nimmt es ueber
-- den Task SCAN_SNAPSHOT auf und laedt es zu /api/hub/scan-snapshots hoch.
-- Eigene Tabelle, damit Scan-Listen die Bilddaten nicht mitladen.

CREATE TABLE IF NOT EXISTS "ScanSnapshot" (
  "id" SERIAL PRIMARY KEY,
  "scanId" INTEGER NOT NULL,
  "cameraId" INTEGER,
  "image" BYTEA NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScanSnapshot_scanId_fkey" FOREIGN KEY ("scanId")
    REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScanSnapshot_cameraId_fkey" FOREIGN KEY ("cameraId")
    REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ScanSnapshot_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScanSnapshot_scanId_key" ON "ScanSnapshot"("scanId");
CREATE INDEX IF NOT EXISTS "ScanSnapshot_accountId_idx" ON "ScanSnapshot"("accountId");
CREATE INDEX IF NOT EXISTS "ScanSnapshot_cameraId_idx" ON "ScanSnapshot"("cameraId");

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE "ScanSnapshot" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ScanSnapshot' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "ScanSnapshot"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
