-- Pumpen-basierte Zeitplaene mit Ventil-Sequenz:
--  * valveSequence → geordnete Ventil-Device-IDs (deviceId = Pumpe)
--  * runState      → laufender Sequenz-Plan (vom 5-Min-Cron abgearbeitet)
--  * smartRain     → Dauer wetterabhaengig skalieren
-- IF NOT EXISTS-Guards, damit wiederholtes `migrate deploy` harmlos bleibt.

ALTER TABLE "IrrigationSchedule" ADD COLUMN IF NOT EXISTS "smartRain" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IrrigationSchedule" ADD COLUMN IF NOT EXISTS "valveSequence" JSONB;
ALTER TABLE "IrrigationSchedule" ADD COLUMN IF NOT EXISTS "runState" JSONB;
