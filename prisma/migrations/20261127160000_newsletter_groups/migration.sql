-- Newsletter-Gruppen (Gäste › Newsletter): Gruppen mit Mitgliedern, Empfänger-Gruppen je
-- Aussendung, Schalter für die Gruppe „Abos aus anny“ (ab Werk aus). Nur neue Tabellen
-- und Spalten. Am Ende: feste Gruppe „Website“ je Mandant mit Abonnenten, alle
-- bisherigen Website-Anmeldungen und die alte Website-Liste (source website/import) hinein.
-- AlterTable
ALTER TABLE "NewsletterConfig" ADD COLUMN     "annyAutoSubscribe" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "annySyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NewsletterCampaign" ADD COLUMN     "groupIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "NewsletterGroup" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterGroupMember" (
    "accountId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "subscriberId" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterGroupMember_pkey" PRIMARY KEY ("groupId","subscriberId")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterGroup_accountId_name_key" ON "NewsletterGroup"("accountId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterGroup_accountId_key_key" ON "NewsletterGroup"("accountId", "key");

-- CreateIndex
CREATE INDEX "NewsletterGroupMember_subscriberId_idx" ON "NewsletterGroupMember"("subscriberId");

-- CreateIndex
CREATE INDEX "NewsletterGroupMember_accountId_idx" ON "NewsletterGroupMember"("accountId");

-- AddForeignKey
ALTER TABLE "NewsletterGroup" ADD CONSTRAINT "NewsletterGroup_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterGroupMember" ADD CONSTRAINT "NewsletterGroupMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterGroupMember" ADD CONSTRAINT "NewsletterGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "NewsletterGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterGroupMember" ADD CONSTRAINT "NewsletterGroupMember_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "NewsletterSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Feste Gruppe „Website“ für jeden Mandanten, der schon Abonnenten hat.
INSERT INTO "NewsletterGroup" ("accountId", "name", "key", "updatedAt")
SELECT DISTINCT s."accountId", 'Website', 'website', CURRENT_TIMESTAMP
FROM "NewsletterSubscriber" s
ON CONFLICT DO NOTHING;

-- Bisherige Anmeldungen von der Website und die alte Website-Liste hinein.
INSERT INTO "NewsletterGroupMember" ("accountId", "groupId", "subscriberId")
SELECT s."accountId", g."id", s."id"
FROM "NewsletterSubscriber" s
JOIN "NewsletterGroup" g ON g."accountId" = s."accountId" AND g."key" = 'website'
WHERE s."source" IN ('website', 'import')
ON CONFLICT DO NOTHING;
