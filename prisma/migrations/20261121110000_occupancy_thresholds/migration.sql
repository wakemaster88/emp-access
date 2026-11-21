-- Grenzen fuer die Auslastung am Lift, einstellbar je Mandant (Kunden-App und Verwaltung).
ALTER TABLE "GamificationConfig" ADD COLUMN "occupancyMediumFrom" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "GamificationConfig" ADD COLUMN "occupancyHighFrom" INTEGER NOT NULL DEFAULT 25;
