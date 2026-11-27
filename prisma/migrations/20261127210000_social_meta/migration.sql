-- Social Media: Meta-Schnittstelle (Instagram/Facebook). Nur additiv:
-- neue Spalten an "SocialPost" mit Standardwerten, neue Tabelle "SocialMetaConnection".

ALTER TABLE "SocialPost" ADD COLUMN "views" INTEGER;
ALTER TABLE "SocialPost" ADD COLUMN "autoPublish" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SocialPost" ADD COLUMN "publishLockedAt" TIMESTAMP(3);
ALTER TABLE "SocialPost" ADD COLUMN "publishAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SocialPost" ADD COLUMN "publishError" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "containerId" TEXT;

CREATE TABLE "SocialMetaConnection" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "userToken" TEXT,
    "pageChoices" JSONB,
    "pageId" TEXT,
    "pageName" TEXT,
    "pageToken" TEXT,
    "igUserId" TEXT,
    "igUsername" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedBy" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "statsSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMetaConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialMetaConnection_accountId_key" ON "SocialMetaConnection"("accountId");

ALTER TABLE "SocialMetaConnection" ADD CONSTRAINT "SocialMetaConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
