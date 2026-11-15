-- Gamification Etappe 3: Challenges (Aufgabe erfüllt / Top X) und Angebote der Kunden-App.
CREATE TYPE "ChallengeKind" AS ENUM ('TASK', 'TOP_X');

CREATE TABLE "Challenge" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ChallengeKind" NOT NULL,
    "metric" "GamiMetric" NOT NULL,
    "threshold" INTEGER,
    "topCount" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "voucherLabel" TEXT,
    "voucherValidDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "settledAt" TIMESTAMP(3),
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Challenge_accountId_idx" ON "Challenge"("accountId");
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChallengeAward" (
    "id" SERIAL NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "rank" INTEGER,
    "voucherId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChallengeAward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChallengeAward_challengeId_ticketId_key" ON "ChallengeAward"("challengeId", "ticketId");
CREATE INDEX "ChallengeAward_accountId_idx" ON "ChallengeAward"("accountId");
CREATE INDEX "ChallengeAward_ticketId_idx" ON "ChallengeAward"("ticketId");
CREATE INDEX "ChallengeAward_voucherId_idx" ON "ChallengeAward"("voucherId");
ALTER TABLE "ChallengeAward" ADD CONSTRAINT "ChallengeAward_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeAward" ADD CONSTRAINT "ChallengeAward_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeAward" ADD CONSTRAINT "ChallengeAward_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChallengeAward" ADD CONSTRAINT "ChallengeAward_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RiderOffer" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiderOffer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RiderOffer_accountId_idx" ON "RiderOffer"("accountId");
ALTER TABLE "RiderOffer" ADD CONSTRAINT "RiderOffer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
