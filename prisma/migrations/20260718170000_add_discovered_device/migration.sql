-- Vom Hub automatisch entdeckte Geraete im lokalen Netz (ARP-Scan).

CREATE TABLE IF NOT EXISTS "DiscoveredDevice" (
  "id" SERIAL PRIMARY KEY,
  "macAddress" TEXT NOT NULL,
  "ipAddress" TEXT,
  "iface" TEXT,
  "hubName" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscoveredDevice_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveredDevice_accountId_macAddress_key"
  ON "DiscoveredDevice"("accountId", "macAddress");
CREATE INDEX IF NOT EXISTS "DiscoveredDevice_accountId_lastSeenAt_idx"
  ON "DiscoveredDevice"("accountId", "lastSeenAt");

-- Row Level Security
ALTER TABLE "DiscoveredDevice" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'DiscoveredDevice' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "DiscoveredDevice"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
