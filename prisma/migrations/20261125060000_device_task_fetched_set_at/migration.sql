-- taskSetAt des Einmal-Oeffnens, das der Drehkreuz-Pi zuletzt abgeholt hat.
-- Rein additiv und nullable: aeltere Zeilen (null) und aelterer Code
-- arbeiten unveraendert weiter.
ALTER TABLE "Device" ADD COLUMN "taskFetchedSetAt" TIMESTAMP(3);
