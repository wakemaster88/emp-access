-- Challenge kann am Endtag zu einer Uhrzeit enden (Europe/Berlin, "HH:MM").
ALTER TABLE "Challenge" ADD COLUMN "endTime" TEXT;
