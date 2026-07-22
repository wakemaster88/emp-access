-- AlterTable
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "dataRetention" JSONB;
