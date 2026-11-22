-- Früheres Start-Gerät: Scans vor diesem Zeitpunkt zählen in der Rückrechnung als Starts.
ALTER TABLE "Device" ADD COLUMN "legacyStartsUntil" TIMESTAMP(3);
