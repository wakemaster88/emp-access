-- Vorschaubild (ca. 480 px) zu jedem Foto einer Foto-Challenge; ältere Fotos haben keins.
ALTER TABLE "ChallengeEntry" ADD COLUMN "thumbBlob" TEXT;
ALTER TABLE "ChallengeEntry" ADD COLUMN "thumb" BYTEA;

-- Tagesgrenze der KI-Fotoprüfung je Person (Profilbild und Challenge-Fotos).
ALTER TABLE "RiderProfile" ADD COLUMN "photoCheckDay" DATE;
ALTER TABLE "RiderProfile" ADD COLUMN "photoChecks" INTEGER NOT NULL DEFAULT 0;
