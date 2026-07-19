-- Erweiterte Geraeteinformationen aus dem aktiven Netzwerk-Scan des Hubs.

ALTER TABLE "DiscoveredDevice" ADD COLUMN IF NOT EXISTS "hostname" TEXT;
ALTER TABLE "DiscoveredDevice" ADD COLUMN IF NOT EXISTS "vendor" TEXT;
ALTER TABLE "DiscoveredDevice" ADD COLUMN IF NOT EXISTS "openPorts" JSONB;
ALTER TABLE "DiscoveredDevice" ADD COLUMN IF NOT EXISTS "deviceType" TEXT;
ALTER TABLE "DiscoveredDevice" ADD COLUMN IF NOT EXISTS "responseMs" INTEGER;
ALTER TABLE "DiscoveredDevice" ADD COLUMN IF NOT EXISTS "reachable" BOOLEAN NOT NULL DEFAULT TRUE;
