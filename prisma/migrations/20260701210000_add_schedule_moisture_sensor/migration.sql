-- Bodenfeuchte-Sensor je Bewaesserungs-Zeitplan: GARDENA SENSOR-Service-ID +
-- Feuchte-Schwelle (%). Der Cron setzt den Lauf bei feuchtem Boden aus und
-- skaliert die Dauer bei trockenem Boden.
-- IF NOT EXISTS-Guards, damit wiederholtes `migrate deploy` harmlos bleibt.

ALTER TABLE "IrrigationSchedule" ADD COLUMN IF NOT EXISTS "sensorServiceId" TEXT;
ALTER TABLE "IrrigationSchedule" ADD COLUMN IF NOT EXISTS "moistureThresholdPct" INTEGER;
