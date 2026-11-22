-- Unterprofile der Betriebszeiten (z. B. Bahnmieten unter Wasserski), belegte
-- Anlagen fuer die Ueberschneidungspruefung und feste anny-Ressource.
ALTER TABLE "OperatingSchedule" ADD COLUMN "parentId" INTEGER;
ALTER TABLE "OperatingSchedule" ADD COLUMN "facilities" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "OperatingSchedule" ADD COLUMN "annyResourceId" TEXT;

CREATE INDEX "OperatingSchedule_parentId_idx" ON "OperatingSchedule"("parentId");

ALTER TABLE "OperatingSchedule" ADD CONSTRAINT "OperatingSchedule_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "OperatingSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
