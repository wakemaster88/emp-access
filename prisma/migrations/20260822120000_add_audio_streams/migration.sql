-- Benannte Webradio-Sender, die in Zonen per Dropdown gewaehlt werden.
-- Bestehende Zonen-URLs werden in Sender uebernommen, damit nichts verstummt.

CREATE TABLE "AudioStream" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudioStream_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AudioStream_accountId_idx" ON "AudioStream"("accountId");

ALTER TABLE "AudioStream"
  ADD CONSTRAINT "AudioStream_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AudioZone" ADD COLUMN "streamId" INTEGER;

CREATE INDEX "AudioZone_streamId_idx" ON "AudioZone"("streamId");

INSERT INTO "AudioStream" ("accountId", "name", "url", "createdAt", "updatedAt")
SELECT
  z."accountId",
  CASE WHEN COUNT(*) = 1 THEN MIN(z."name") ELSE 'Webradio' END,
  z."streamUrl",
  NOW(),
  NOW()
FROM "AudioZone" z
WHERE z."streamUrl" IS NOT NULL AND btrim(z."streamUrl") <> ''
GROUP BY z."accountId", z."streamUrl";

UPDATE "AudioZone" z
SET "streamId" = s."id"
FROM "AudioStream" s
WHERE z."accountId" = s."accountId"
  AND z."streamUrl" = s."url";

ALTER TABLE "AudioZone"
  ADD CONSTRAINT "AudioZone_streamId_fkey"
  FOREIGN KEY ("streamId") REFERENCES "AudioStream"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
