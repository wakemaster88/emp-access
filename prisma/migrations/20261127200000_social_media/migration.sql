-- Modul Social Media (Newsletter › Social Media): Kampagnen mit Beiträgen je Kanal.
-- Nur neue Tabellen und eine neue, leere Spalte an NewsletterCampaign (Aussendung
-- gehört zu einer Kampagne). Alter Code liest das Schema unverändert.

-- AlterTable
ALTER TABLE "NewsletterCampaign" ADD COLUMN     "socialCampaignId" INTEGER;

-- CreateTable
CREATE TABLE "SocialCampaign" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "startsOn" DATE,
    "endsOn" DATE,
    "landingUrl" TEXT,
    "hashtags" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'POST',
    "text" TEXT NOT NULL DEFAULT '',
    "media" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "link" TEXT,
    "plannedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDEA',
    "publishedAt" TIMESTAMP(3),
    "postUrl" TEXT,
    "externalId" TEXT,
    "reach" INTEGER,
    "interactions" INTEGER,
    "clicks" INTEGER,
    "statsAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialCampaign_accountId_startsOn_idx" ON "SocialCampaign"("accountId", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "SocialCampaign_accountId_slug_key" ON "SocialCampaign"("accountId", "slug");

-- CreateIndex
CREATE INDEX "SocialPost_accountId_plannedAt_idx" ON "SocialPost"("accountId", "plannedAt");

-- CreateIndex
CREATE INDEX "SocialPost_campaignId_idx" ON "SocialPost"("campaignId");

-- CreateIndex (NewsletterCampaign hat nur wenige Zeilen, daher ohne CONCURRENTLY)
CREATE INDEX "NewsletterCampaign_socialCampaignId_idx" ON "NewsletterCampaign"("socialCampaignId");

-- AddForeignKey
ALTER TABLE "NewsletterCampaign" ADD CONSTRAINT "NewsletterCampaign_socialCampaignId_fkey" FOREIGN KEY ("socialCampaignId") REFERENCES "SocialCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialCampaign" ADD CONSTRAINT "SocialCampaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SocialCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
