-- Zeitpunkt, zu dem Device.task gesetzt wurde: Einmal-Oeffnen am Pi wird nach
-- einer Minute nicht mehr ausgeliefert. Rein additiv und nullable: aeltere
-- Zeilen (null) verhalten sich wie bisher.
ALTER TABLE "Device" ADD COLUMN "taskSetAt" TIMESTAMP(3);
