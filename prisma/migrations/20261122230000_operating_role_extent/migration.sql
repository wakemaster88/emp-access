-- Betriebszeiten: Rolle je Bereich (Lift, Shop, Strandbad) statt Suche über den
-- Namen, und Automationen, die auch zu Bahnmieten und Kursen (Unterprofilen)
-- laufen können. Standard bleibt wie bisher: keine Rolle, nur der Bereich selbst.
DO $$ BEGIN
  CREATE TYPE "OperatingRole" AS ENUM ('LIFT', 'SHOP', 'BEACH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OperatingExtent" AS ENUM ('SELF', 'BOOKED_SUBPROFILES', 'SUBPROFILES');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "OperatingSchedule" ADD COLUMN IF NOT EXISTS "role" "OperatingRole";
ALTER TABLE "RoomRule" ADD COLUMN IF NOT EXISTS "operatingExtent" "OperatingExtent" NOT NULL DEFAULT 'SELF';
ALTER TABLE "RoomClimate" ADD COLUMN IF NOT EXISTS "operatingExtent" "OperatingExtent" NOT NULL DEFAULT 'SELF';
ALTER TABLE "AudioZone" ADD COLUMN IF NOT EXISTS "musicExtent" "OperatingExtent" NOT NULL DEFAULT 'SELF';
