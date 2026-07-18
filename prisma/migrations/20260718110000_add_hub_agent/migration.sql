-- Lokaler Hub (On-Site-Agent): HubAgent (Heartbeat/Status) und HubTask
-- (Task-Queue Cloud -> Hub, per Polling abgeholt).

CREATE TABLE IF NOT EXISTS "HubAgent" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "hostname" TEXT,
  "version" TEXT,
  "modules" JSONB,
  "lastSeenAt" TIMESTAMP(3),
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HubAgent_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "HubAgent_accountId_name_key" ON "HubAgent"("accountId", "name");
CREATE INDEX IF NOT EXISTS "HubAgent_accountId_idx" ON "HubAgent"("accountId");

CREATE TABLE IF NOT EXISTS "HubTask" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "error" TEXT,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "HubTask_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "HubTask_accountId_status_idx" ON "HubTask"("accountId", "status");
CREATE INDEX IF NOT EXISTS "HubTask_accountId_createdAt_idx" ON "HubTask"("accountId", "createdAt");

-- Row Level Security
ALTER TABLE "HubAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HubTask" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'HubAgent' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "HubAgent"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'HubTask' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "HubTask"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
