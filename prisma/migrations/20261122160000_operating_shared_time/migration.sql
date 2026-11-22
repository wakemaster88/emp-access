-- Geteilte Zeit: Buchungsangebote (Bahnmiete, Kurs) duerfen sich auf derselben
-- Anlage ueberschneiden, weil anny Doppelbuchungen verhindert.
ALTER TABLE "OperatingSchedule" ADD COLUMN "sharedTime" BOOLEAN NOT NULL DEFAULT false;
