-- Halteverbot: Schlüssel der Meldung vom Hub. Wiederholt der Hub eine
-- Meldung, deren Antwort ihn nicht erreichte (Zeitüberschreitung, Netz),
-- legt die Cloud keine zweite Sichtung an und schickt keine zweite
-- Nachricht. Rein additiv und nullable: Ältere Hubs schicken keinen
-- Schlüssel, bestehende Zeilen haben keinen.
ALTER TABLE "VehicleSighting" ADD COLUMN IF NOT EXISTS "reportKey" TEXT;
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "noParkNotifyKey" TEXT;
