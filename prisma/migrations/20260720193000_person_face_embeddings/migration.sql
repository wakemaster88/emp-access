-- AlterTable
ALTER TABLE "PersonSighting" ADD COLUMN IF NOT EXISTS "matchScore" DOUBLE PRECISION;
ALTER TABLE "PersonSighting" ADD COLUMN IF NOT EXISTS "matchMethod" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PersonFaceEmbedding" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "listedPersonId" INTEGER NOT NULL,
    "embedding" BYTEA NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'buffalo_l',
    "sourceSightingId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonFaceEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PersonFaceEmbedding_accountId_listedPersonId_idx" ON "PersonFaceEmbedding"("accountId", "listedPersonId");
CREATE INDEX IF NOT EXISTS "PersonFaceEmbedding_listedPersonId_idx" ON "PersonFaceEmbedding"("listedPersonId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PersonFaceEmbedding" ADD CONSTRAINT "PersonFaceEmbedding_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PersonFaceEmbedding" ADD CONSTRAINT "PersonFaceEmbedding_listedPersonId_fkey"
    FOREIGN KEY ("listedPersonId") REFERENCES "ListedPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
