-- Audio und Geraete an Raeume und Betriebszeiten koppeln.
--
-- * AudioZone.keyRoomId: eine Zone beschallt einen Raum und erbt dessen
--   Betriebszeit.
-- * AudioSchedule: Zeitpunkt wahlweise als Uhrzeit oder als Betriebsbeginn/
--   -ende mit Versatz; dazu eine Betriebszeit-Bedingung wie bei den Regeln.
-- * Device.schedule entfaellt: der Wochenplan am Geraet wurde nie ausgefuehrt.
--   Schaltzeiten laufen ueber Regeln mit Betriebsbeginn/-ende.

CREATE TYPE "AudioScheduleTrigger" AS ENUM ('TIME', 'OPENING', 'CLOSING');

ALTER TABLE "AudioZone" ADD COLUMN "keyRoomId" INTEGER;
CREATE INDEX "AudioZone_keyRoomId_idx" ON "AudioZone"("keyRoomId");
ALTER TABLE "AudioZone"
  ADD CONSTRAINT "AudioZone_keyRoomId_fkey"
  FOREIGN KEY ("keyRoomId") REFERENCES "KeyRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AudioSchedule"
  ADD COLUMN "trigger" "AudioScheduleTrigger" NOT NULL DEFAULT 'TIME',
  ADD COLUMN "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "operatingScheduleId" INTEGER,
  ADD COLUMN "operating" "RuleOperatingCondition" NOT NULL DEFAULT 'ANY',
  ALTER COLUMN "timeOfDay" DROP NOT NULL;
CREATE INDEX "AudioSchedule_operatingScheduleId_idx" ON "AudioSchedule"("operatingScheduleId");
ALTER TABLE "AudioSchedule"
  ADD CONSTRAINT "AudioSchedule_operatingScheduleId_fkey"
  FOREIGN KEY ("operatingScheduleId") REFERENCES "OperatingSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Device" DROP COLUMN "schedule";
