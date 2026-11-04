-- Klima je Raum: Solltemperatur halten (Fuehler + Heizungen mit Hysterese).
CREATE TABLE IF NOT EXISTS "RoomClimate" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "roomId" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sensorDeviceId" INTEGER NOT NULL,
  "heaterDeviceIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "targetC" DOUBLE PRECISION NOT NULL DEFAULT 21,
  "hysteresisC" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "setbackC" DOUBLE PRECISION,
  "preheatMinutes" INTEGER NOT NULL DEFAULT 30,
  "operatingScheduleId" INTEGER,
  "lastTempC" DOUBLE PRECISION,
  "lastReadAt" TIMESTAMP(3),
  "heating" BOOLEAN,
  "lastSwitchAt" TIMESTAMP(3),
  "currentTargetC" DOUBLE PRECISION,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoomClimate_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomClimate_roomId_fkey" FOREIGN KEY ("roomId")
    REFERENCES "KeyRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomClimate_sensorDeviceId_fkey" FOREIGN KEY ("sensorDeviceId")
    REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomClimate_operatingScheduleId_fkey" FOREIGN KEY ("operatingScheduleId")
    REFERENCES "OperatingSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RoomClimate_roomId_key" ON "RoomClimate"("roomId");
CREATE INDEX IF NOT EXISTS "RoomClimate_accountId_idx" ON "RoomClimate"("accountId");
CREATE INDEX IF NOT EXISTS "RoomClimate_sensorDeviceId_idx" ON "RoomClimate"("sensorDeviceId");
CREATE INDEX IF NOT EXISTS "RoomClimate_operatingScheduleId_idx" ON "RoomClimate"("operatingScheduleId");
