-- Gamification Etappe 1: Tagessummen, Meilensteine, Leistungs-Gutscheine.
CREATE TYPE "VoucherKind" AS ENUM ('ACCESS', 'BENEFIT');
CREATE TYPE "GamiMetric" AS ENUM ('VISIT_DAYS', 'STARTS', 'STREAK_WEEKS');
CREATE TYPE "GamiPeriod" AS ENUM ('SEASON', 'MONTH');

ALTER TABLE "Device" ADD COLUMN "countsAsStart" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Voucher" ADD COLUMN "kind" "VoucherKind" NOT NULL DEFAULT 'ACCESS';
ALTER TABLE "Voucher" ADD COLUMN "label" TEXT;
ALTER TABLE "Voucher" ADD COLUMN "ownerTicketId" INTEGER;
ALTER TABLE "Voucher" ADD COLUMN "redeemedVia" TEXT;
CREATE INDEX "Voucher_accountId_kind_idx" ON "Voucher"("accountId", "kind");
CREATE INDEX "Voucher_ownerTicketId_idx" ON "Voucher"("ownerTicketId");

CREATE TABLE "GamificationConfig" (
    "id" SERIAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startCapPerDay" INTEGER NOT NULL DEFAULT 10,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GamificationConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GamificationConfig_accountId_key" ON "GamificationConfig"("accountId");
ALTER TABLE "GamificationConfig" ADD CONSTRAINT "GamificationConfig_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RiderDayStat" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "firstStartAt" TIMESTAMP(3) NOT NULL,
    "lastStartAt" TIMESTAMP(3) NOT NULL,
    "accountId" INTEGER NOT NULL,
    CONSTRAINT "RiderDayStat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiderDayStat_ticketId_day_key" ON "RiderDayStat"("ticketId", "day");
CREATE INDEX "RiderDayStat_accountId_day_idx" ON "RiderDayStat"("accountId", "day");
ALTER TABLE "RiderDayStat" ADD CONSTRAINT "RiderDayStat_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderDayStat" ADD CONSTRAINT "RiderDayStat_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Milestone" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "metric" "GamiMetric" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "period" "GamiPeriod" NOT NULL DEFAULT 'SEASON',
    "voucherLabel" TEXT,
    "voucherValidDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Milestone_accountId_idx" ON "Milestone"("accountId");
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MilestoneAward" (
    "id" SERIAL NOT NULL,
    "milestoneId" INTEGER NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "periodKey" TEXT NOT NULL,
    "voucherId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MilestoneAward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MilestoneAward_milestoneId_ticketId_periodKey_key" ON "MilestoneAward"("milestoneId", "ticketId", "periodKey");
CREATE INDEX "MilestoneAward_accountId_idx" ON "MilestoneAward"("accountId");
CREATE INDEX "MilestoneAward_ticketId_idx" ON "MilestoneAward"("ticketId");
CREATE INDEX "MilestoneAward_voucherId_idx" ON "MilestoneAward"("voucherId");
ALTER TABLE "MilestoneAward" ADD CONSTRAINT "MilestoneAward_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MilestoneAward" ADD CONSTRAINT "MilestoneAward_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MilestoneAward" ADD CONSTRAINT "MilestoneAward_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MilestoneAward" ADD CONSTRAINT "MilestoneAward_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
