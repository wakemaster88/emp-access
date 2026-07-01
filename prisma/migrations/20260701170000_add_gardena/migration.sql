-- GARDENA smart system Integration: API-Provider, Geraetetyp und Service-ID
-- auf Device. IF NOT EXISTS-Wrapper, damit ein wiederholtes `migrate deploy`
-- (z. B. nach Branch-Wechsel auf einer bereits gepatchten DB) harmlos bleibt.

ALTER TYPE "ApiProvider" ADD VALUE IF NOT EXISTS 'GARDENA';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'GARDENA_VALVE';

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "gardenaServiceId" TEXT;
