-- Kunden-App: Familienkonto. Erwachsene sehen alle Mitglieder, Kinder haben keinen eigenen Zugang.
CREATE TABLE "RiderFamily" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiderFamily_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RiderFamily_accountId_idx" ON "RiderFamily"("accountId");
ALTER TABLE "RiderFamily" ADD CONSTRAINT "RiderFamily_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RiderProfile" ADD COLUMN "familyId" INTEGER;
ALTER TABLE "RiderProfile" ADD COLUMN "familyAdult" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "RiderProfile_familyId_idx" ON "RiderProfile"("familyId");
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "RiderFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;
