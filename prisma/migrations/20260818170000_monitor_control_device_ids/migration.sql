-- MonitorConfig.controlDeviceIds: Geraete, die ein oeffentlicher Scan-Monitor
-- schalten darf (z.B. Shelly am Drehkreuz). Getrennt von deviceIds, damit
-- Scan-Quellen und Steuergeraete nicht vermischt werden.

ALTER TABLE "MonitorConfig"
  ADD COLUMN IF NOT EXISTS "controlDeviceIds" JSONB NOT NULL DEFAULT '[]';
