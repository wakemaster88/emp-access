-- Philips Hue als Raum-Geraet: Lampe hinter einer Bridge, geschaltet vom Hub.
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'HUE_LIGHT';
ALTER TABLE "Device"
  ADD COLUMN IF NOT EXISTS "hueBridgeId" TEXT,
  ADD COLUMN IF NOT EXISTS "hueLightId" TEXT;
CREATE INDEX IF NOT EXISTS "Device_accountId_hueBridgeId_hueLightId_idx"
  ON "Device"("accountId", "hueBridgeId", "hueLightId");
