-- LOQED-Schloss: API-Provider, Geraetetyp und Lock-ID auf Device.
--
-- Das Schloss haengt zwar auch in der Shelly Cloud und liefert dort seinen
-- Zustand, nimmt darueber aber keine Befehle an. Gefahren wird es deshalb ueber
-- die LOQED Integrations-API mit eigenem Token.
--
-- IF NOT EXISTS-Wrapper, damit ein zweites `migrate deploy` (z. B. nach
-- Branch-Wechsel auf einer bereits gepatchten DB) harmlos bleibt.

ALTER TYPE "ApiProvider" ADD VALUE IF NOT EXISTS 'LOQED';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'LOQED_SMARTLOCK';

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "loqedLockId" TEXT;
