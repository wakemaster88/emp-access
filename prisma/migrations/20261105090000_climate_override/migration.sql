-- Klima uebersteuern mit Ablauf: Soll gilt bis zu einem Zeitpunkt, danach wieder der Plan.
ALTER TABLE "RoomClimate" ADD COLUMN IF NOT EXISTS "overrideC" DOUBLE PRECISION;
ALTER TABLE "RoomClimate" ADD COLUMN IF NOT EXISTS "overrideUntil" TIMESTAMP(3);
