-- Challenges: Foto-Challenge (Fotos + Stimmen) und Abstimmung (Antworten + Stimmen).
ALTER TYPE "ChallengeKind" ADD VALUE 'PHOTO';
ALTER TYPE "ChallengeKind" ADD VALUE 'POLL';

-- CreateTable
CREATE TABLE "ChallengeOption" (
    "id" SERIAL NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accountId" INTEGER NOT NULL,

    CONSTRAINT "ChallengeOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeEntry" (
    "id" SERIAL NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL,
    "imageBlob" TEXT,
    "image" BYTEA,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeVote" (
    "id" SERIAL NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL,
    "entryId" INTEGER,
    "optionId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChallengeOption_challengeId_idx" ON "ChallengeOption"("challengeId");

-- CreateIndex
CREATE INDEX "ChallengeOption_accountId_idx" ON "ChallengeOption"("accountId");

-- CreateIndex
CREATE INDEX "ChallengeEntry_accountId_idx" ON "ChallengeEntry"("accountId");

-- CreateIndex
CREATE INDEX "ChallengeEntry_profileId_idx" ON "ChallengeEntry"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeEntry_challengeId_profileId_key" ON "ChallengeEntry"("challengeId", "profileId");

-- CreateIndex
CREATE INDEX "ChallengeVote_accountId_idx" ON "ChallengeVote"("accountId");

-- CreateIndex
CREATE INDEX "ChallengeVote_entryId_idx" ON "ChallengeVote"("entryId");

-- CreateIndex
CREATE INDEX "ChallengeVote_optionId_idx" ON "ChallengeVote"("optionId");

-- CreateIndex
CREATE INDEX "ChallengeVote_profileId_idx" ON "ChallengeVote"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeVote_challengeId_profileId_key" ON "ChallengeVote"("challengeId", "profileId");

-- AddForeignKey
ALTER TABLE "ChallengeOption" ADD CONSTRAINT "ChallengeOption_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeOption" ADD CONSTRAINT "ChallengeOption_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ChallengeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ChallengeOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
