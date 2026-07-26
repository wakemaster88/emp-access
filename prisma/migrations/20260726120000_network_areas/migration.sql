-- CreateTable
CREATE TABLE IF NOT EXISTS "NetworkArea" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "vlanId" INTEGER,
    "ipFrom" TEXT,
    "ipTo" TEXT,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkArea_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "NetworkClient" ADD COLUMN IF NOT EXISTS "areaId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkArea_accountId_name_key" ON "NetworkArea"("accountId", "name");
CREATE INDEX IF NOT EXISTS "NetworkArea_accountId_idx" ON "NetworkArea"("accountId");
CREATE INDEX IF NOT EXISTS "NetworkArea_vlanId_idx" ON "NetworkArea"("vlanId");
CREATE INDEX IF NOT EXISTS "NetworkClient_areaId_idx" ON "NetworkClient"("areaId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "NetworkArea" ADD CONSTRAINT "NetworkArea_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "NetworkVlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "NetworkArea" ADD CONSTRAINT "NetworkArea_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "NetworkClient" ADD CONSTRAINT "NetworkClient_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "NetworkArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
