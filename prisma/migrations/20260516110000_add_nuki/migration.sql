-- Nuki-Integration: API-Provider, Geraetetyp und Smartlock-ID auf Device.
-- IF NOT EXISTS-Wrapper, damit ein zweites `migrate deploy` (z. B. nach
-- Branch-Wechsel auf einer bereits gepatchten DB) harmlos bleibt.

ALTER TYPE "ApiProvider" ADD VALUE IF NOT EXISTS 'NUKI';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'NUKI_SMARTLOCK';

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "nukiSmartlockId" TEXT;
