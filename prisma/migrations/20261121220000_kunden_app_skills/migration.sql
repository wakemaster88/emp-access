-- Skills der Kunden-App: Geraete schalten als Belohnung (statt/zusaetzlich zum Gutschein).

-- CreateEnum
CREATE TYPE "RiderSkillKind" AS ENUM ('DEVICE', 'MUSIC');

-- AlterTable
ALTER TABLE "AudioZone" ADD COLUMN     "riderChoiceUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Challenge" ADD COLUMN     "skillId" INTEGER,
ADD COLUMN     "skillUses" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "skillValidDays" INTEGER;

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "skillId" INTEGER,
ADD COLUMN     "skillUses" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "skillValidDays" INTEGER;

-- AlterTable
ALTER TABLE "RiderHoliday" ADD COLUMN     "skillId" INTEGER,
ADD COLUMN     "skillUses" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "skillValidDays" INTEGER;

-- CreateTable
CREATE TABLE "RiderSkill" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "RiderSkillKind" NOT NULL,
    "deviceId" INTEGER,
    "minutes" INTEGER NOT NULL DEFAULT 5,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 2,
    "onlyOperating" BOOLEAN NOT NULL DEFAULT true,
    "onlyOnSite" BOOLEAN NOT NULL DEFAULT true,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderSkillGrant" (
    "id" SERIAL NOT NULL,
    "skillId" INTEGER NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "uses" INTEGER NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderSkillGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderSkillUse" (
    "id" SERIAL NOT NULL,
    "skillId" INTEGER NOT NULL,
    "grantId" INTEGER,
    "profileId" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "option" TEXT,
    "until" TIMESTAMP(3),
    "offDone" BOOLEAN NOT NULL DEFAULT false,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderSkillUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderSkill_accountId_idx" ON "RiderSkill"("accountId");

-- CreateIndex
CREATE INDEX "RiderSkillGrant_accountId_idx" ON "RiderSkillGrant"("accountId");

-- CreateIndex
CREATE INDEX "RiderSkillGrant_ticketId_idx" ON "RiderSkillGrant"("ticketId");

-- CreateIndex
CREATE INDEX "RiderSkillGrant_skillId_idx" ON "RiderSkillGrant"("skillId");

-- CreateIndex
CREATE INDEX "RiderSkillUse_accountId_createdAt_idx" ON "RiderSkillUse"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderSkillUse_skillId_createdAt_idx" ON "RiderSkillUse"("skillId", "createdAt");

-- AddForeignKey
ALTER TABLE "RiderSkill" ADD CONSTRAINT "RiderSkill_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkill" ADD CONSTRAINT "RiderSkill_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillGrant" ADD CONSTRAINT "RiderSkillGrant_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "RiderSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillGrant" ADD CONSTRAINT "RiderSkillGrant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillGrant" ADD CONSTRAINT "RiderSkillGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillUse" ADD CONSTRAINT "RiderSkillUse_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "RiderSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillUse" ADD CONSTRAINT "RiderSkillUse_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "RiderSkillGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillUse" ADD CONSTRAINT "RiderSkillUse_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillUse" ADD CONSTRAINT "RiderSkillUse_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "RiderSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "RiderSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderHoliday" ADD CONSTRAINT "RiderHoliday_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "RiderSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

