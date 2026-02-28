-- AlterTable: Add allowReentry to Service if missing (P2022 fix)
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "allowReentry" BOOLEAN NOT NULL DEFAULT false;
