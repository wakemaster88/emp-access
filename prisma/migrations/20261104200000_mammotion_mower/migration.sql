-- Mammotion-Maehroboter als Raum-Geraet: Zustand meldet der Hub, Befehle gehen als Hub-Task.
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'MAMMOTION_MOWER';
ALTER TABLE "Device"
  ADD COLUMN IF NOT EXISTS "mowerName" TEXT,
  ADD COLUMN IF NOT EXISTS "mowerMap" JSONB;
CREATE INDEX IF NOT EXISTS "Device_accountId_mowerName_idx"
  ON "Device"("accountId", "mowerName");
