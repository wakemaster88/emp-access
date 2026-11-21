-- Push an die Kunden-App am Feiertag (einmal je Jahr).
ALTER TABLE "RiderHoliday" ADD COLUMN "pushPlanned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RiderHoliday" ADD COLUMN "pushedYear" INTEGER;
ALTER TABLE "RiderHoliday" ADD COLUMN "pushedAt" TIMESTAMP(3);
ALTER TABLE "RiderHoliday" ADD COLUMN "pushSent" INTEGER;
