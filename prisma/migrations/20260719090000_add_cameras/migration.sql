-- Kameras (Reolink) + Ereignisse: der Hub pollt Bewegungs-/KI-Events ueber
-- die lokale CGI-API und liefert Schnappschuesse in die Cloud.

CREATE TABLE IF NOT EXISTS "Camera" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "httpPort" INTEGER NOT NULL DEFAULT 80,
  "https" BOOLEAN NOT NULL DEFAULT false,
  "username" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "channel" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "snapshot" BYTEA,
  "snapshotAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Camera_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Camera_accountId_name_key" ON "Camera"("accountId", "name");
CREATE INDEX IF NOT EXISTS "Camera_accountId_idx" ON "Camera"("accountId");

CREATE TABLE IF NOT EXISTS "CameraEvent" (
  "id" SERIAL PRIMARY KEY,
  "cameraId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CameraEvent_cameraId_fkey" FOREIGN KEY ("cameraId")
    REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CameraEvent_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CameraEvent_accountId_startedAt_idx" ON "CameraEvent"("accountId", "startedAt");
CREATE INDEX IF NOT EXISTS "CameraEvent_cameraId_startedAt_idx" ON "CameraEvent"("cameraId", "startedAt");

-- Row Level Security
ALTER TABLE "Camera" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CameraEvent" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'Camera' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "Camera"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'CameraEvent' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "CameraEvent"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
