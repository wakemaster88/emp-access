-- Push an Kunden bei neuen Angeboten und Challenges. Bestehende Einträge
-- bekommen pushPlanned = false und werden nie nachträglich gemeldet.
ALTER TABLE "Challenge" ADD COLUMN "pushPlanned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Challenge" ADD COLUMN "pushedAt" TIMESTAMP(3);
ALTER TABLE "Challenge" ADD COLUMN "pushSent" INTEGER;

ALTER TABLE "RiderOffer" ADD COLUMN "pushPlanned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RiderOffer" ADD COLUMN "pushedAt" TIMESTAMP(3);
ALTER TABLE "RiderOffer" ADD COLUMN "pushSent" INTEGER;
