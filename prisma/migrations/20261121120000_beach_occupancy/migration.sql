-- Auslastung Strandbad: Hochrechnungsfaktor und Grenzen (geschaetzte Gaeste vor Ort).
ALTER TABLE "GamificationConfig" ADD COLUMN "beachGuestFactor" DOUBLE PRECISION NOT NULL DEFAULT 3;
ALTER TABLE "GamificationConfig" ADD COLUMN "beachMediumFrom" INTEGER NOT NULL DEFAULT 600;
ALTER TABLE "GamificationConfig" ADD COLUMN "beachHighFrom" INTEGER NOT NULL DEFAULT 1200;
