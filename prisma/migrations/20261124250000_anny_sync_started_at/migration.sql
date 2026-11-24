-- Beginn des laufenden anny-Abgleichs je Verbindung. Gesetzt beim Start,
-- geleert am Ende; ein zweiter Lauf startet erst danach (oder nach 3 Minuten).
ALTER TABLE "ApiConfig" ADD COLUMN IF NOT EXISTS "syncStartedAt" TIMESTAMP(3);
