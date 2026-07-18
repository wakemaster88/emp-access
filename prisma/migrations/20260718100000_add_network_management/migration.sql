-- Netzwerk-Verwaltung: VLANs, Switches/Router, Ports, Anschluesse (Dosen/
-- Patchpanels) und Endgeraete (NetworkClient, optional verknuepft mit einem
-- bestehenden IoT-Device).

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "NetworkDeviceType" AS ENUM ('SWITCH', 'ROUTER', 'ACCESS_POINT', 'FIREWALL', 'OTHER');
CREATE TYPE "NetworkPortStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RESERVED', 'FAULTY');
CREATE TYPE "NetworkOutletType" AS ENUM ('WALL_OUTLET', 'PATCH_PANEL');
CREATE TYPE "NetworkClientType" AS ENUM ('PC', 'PRINTER', 'CAMERA', 'NAS', 'PHONE', 'IOT', 'MONITOR', 'OTHER');

-- ── NetworkVlan ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NetworkVlan" (
  "id" SERIAL PRIMARY KEY,
  "vlanId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "subnet" TEXT,
  "gateway" TEXT,
  "description" TEXT,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkVlan_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkVlan_accountId_vlanId_key" ON "NetworkVlan"("accountId", "vlanId");
CREATE INDEX IF NOT EXISTS "NetworkVlan_accountId_idx" ON "NetworkVlan"("accountId");

-- ── NetworkDevice ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NetworkDevice" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "type" "NetworkDeviceType" NOT NULL DEFAULT 'SWITCH',
  "vendor" TEXT,
  "model" TEXT,
  "ipAddress" TEXT,
  "macAddress" TEXT,
  "location" TEXT,
  "notes" TEXT,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkDevice_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "NetworkDevice_accountId_idx" ON "NetworkDevice"("accountId");

-- ── NetworkOutlet ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NetworkOutlet" (
  "id" SERIAL PRIMARY KEY,
  "label" TEXT NOT NULL,
  "location" TEXT,
  "type" "NetworkOutletType" NOT NULL DEFAULT 'WALL_OUTLET',
  "notes" TEXT,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkOutlet_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkOutlet_accountId_label_key" ON "NetworkOutlet"("accountId", "label");
CREATE INDEX IF NOT EXISTS "NetworkOutlet_accountId_idx" ON "NetworkOutlet"("accountId");

-- ── NetworkPort ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NetworkPort" (
  "id" SERIAL PRIMARY KEY,
  "number" INTEGER NOT NULL,
  "label" TEXT,
  "deviceId" INTEGER NOT NULL,
  "vlanId" INTEGER,
  "poe" BOOLEAN NOT NULL DEFAULT false,
  "status" "NetworkPortStatus" NOT NULL DEFAULT 'ACTIVE',
  "outletId" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkPort_deviceId_fkey" FOREIGN KEY ("deviceId")
    REFERENCES "NetworkDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NetworkPort_vlanId_fkey" FOREIGN KEY ("vlanId")
    REFERENCES "NetworkVlan"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "NetworkPort_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "NetworkOutlet"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkPort_deviceId_number_key" ON "NetworkPort"("deviceId", "number");
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkPort_outletId_key" ON "NetworkPort"("outletId");
CREATE INDEX IF NOT EXISTS "NetworkPort_deviceId_idx" ON "NetworkPort"("deviceId");
CREATE INDEX IF NOT EXISTS "NetworkPort_vlanId_idx" ON "NetworkPort"("vlanId");

-- ── NetworkPortVlan (tagged VLANs / Trunk) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "NetworkPortVlan" (
  "id" SERIAL PRIMARY KEY,
  "portId" INTEGER NOT NULL,
  "vlanId" INTEGER NOT NULL,
  CONSTRAINT "NetworkPortVlan_portId_fkey" FOREIGN KEY ("portId")
    REFERENCES "NetworkPort"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NetworkPortVlan_vlanId_fkey" FOREIGN KEY ("vlanId")
    REFERENCES "NetworkVlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkPortVlan_portId_vlanId_key" ON "NetworkPortVlan"("portId", "vlanId");
CREATE INDEX IF NOT EXISTS "NetworkPortVlan_portId_idx" ON "NetworkPortVlan"("portId");
CREATE INDEX IF NOT EXISTS "NetworkPortVlan_vlanId_idx" ON "NetworkPortVlan"("vlanId");

-- ── NetworkClient ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NetworkClient" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "type" "NetworkClientType" NOT NULL DEFAULT 'OTHER',
  "ipAddress" TEXT,
  "macAddress" TEXT,
  "isStatic" BOOLEAN NOT NULL DEFAULT false,
  "deviceId" INTEGER,
  "portId" INTEGER,
  "vlanId" INTEGER,
  "notes" TEXT,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkClient_deviceId_fkey" FOREIGN KEY ("deviceId")
    REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NetworkClient_portId_fkey" FOREIGN KEY ("portId")
    REFERENCES "NetworkPort"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "NetworkClient_vlanId_fkey" FOREIGN KEY ("vlanId")
    REFERENCES "NetworkVlan"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "NetworkClient_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkClient_deviceId_key" ON "NetworkClient"("deviceId");
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkClient_portId_key" ON "NetworkClient"("portId");
CREATE INDEX IF NOT EXISTS "NetworkClient_accountId_idx" ON "NetworkClient"("accountId");
CREATE INDEX IF NOT EXISTS "NetworkClient_vlanId_idx" ON "NetworkClient"("vlanId");

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE "NetworkVlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NetworkDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NetworkOutlet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NetworkClient" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'NetworkVlan' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "NetworkVlan"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'NetworkDevice' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "NetworkDevice"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'NetworkOutlet' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "NetworkOutlet"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'NetworkClient' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "NetworkClient"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
