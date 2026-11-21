-- Awards: Day One und Ice Breaker ohne Handeingabe. Neue Zaehlarten "erster
-- Tag des Jahres" und "kalte Tage" (Wassertemperatur aus dem Klimaverlauf),
-- dazu die Grad-Grenze am Award und der Wasser-Fuehler in den Einstellungen.
-- Die Umstellung der beiden Awards folgt in der naechsten Migration, weil
-- neue Enum-Werte erst nach dem Commit nutzbar sind.

ALTER TYPE "GamiMetric" ADD VALUE 'OPENING_DAY';
ALTER TYPE "GamiMetric" ADD VALUE 'COLD_DAYS';

ALTER TABLE "Milestone" ADD COLUMN "tempBelow" DOUBLE PRECISION;

ALTER TABLE "GamificationConfig" ADD COLUMN "waterSensorDeviceId" INTEGER;

ALTER TABLE "GamificationConfig"
  ADD CONSTRAINT "GamificationConfig_waterSensorDeviceId_fkey"
  FOREIGN KEY ("waterSensorDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
