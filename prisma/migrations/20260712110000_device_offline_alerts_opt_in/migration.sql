-- Offline-Push pro Geraet aktivierbar (Opt-in, Default: aus).
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "offlineAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
