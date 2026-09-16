-- Soundweb London (BSS) aus dem Dashboard steuern.
--
-- Der Hub haelt je Prozessor eine DI-Verbindung (TCP 1023), abonniert die
-- eingerichteten State Variables und meldet Verbindungszustand und Werte
-- zurueck; Befehle laufen als HubTask (SOUNDWEB_SET / SOUNDWEB_SYNC).

CREATE TYPE "SoundwebControlKind" AS ENUM ('GAIN', 'MUTE', 'PERCENT', 'SELECT', 'PRESET');

CREATE TABLE "SoundwebDevice" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 1023,
    "node" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "hubName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoundwebDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SoundwebControl" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT,
    "kind" "SoundwebControlKind" NOT NULL,
    "node" INTEGER,
    "virtualDevice" INTEGER NOT NULL DEFAULT 3,
    "objectId" INTEGER NOT NULL DEFAULT 0,
    "stateVariable" INTEGER NOT NULL DEFAULT 0,
    "minDb" DOUBLE PRECISION NOT NULL DEFAULT -80,
    "maxDb" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "options" JSONB,
    "presetId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "value" INTEGER,
    "valueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoundwebControl_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SoundwebDevice_accountId_sortOrder_idx" ON "SoundwebDevice"("accountId", "sortOrder");
CREATE INDEX "SoundwebControl_accountId_idx" ON "SoundwebControl"("accountId");
CREATE INDEX "SoundwebControl_deviceId_sortOrder_idx" ON "SoundwebControl"("deviceId", "sortOrder");

ALTER TABLE "SoundwebDevice" ADD CONSTRAINT "SoundwebDevice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SoundwebControl" ADD CONSTRAINT "SoundwebControl_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SoundwebControl" ADD CONSTRAINT "SoundwebControl_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "SoundwebDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
