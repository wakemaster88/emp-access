-- AlterTable
ALTER TABLE "ListedPerson" ADD COLUMN IF NOT EXISTS "notifyOnDetection" BOOLEAN NOT NULL DEFAULT false;
