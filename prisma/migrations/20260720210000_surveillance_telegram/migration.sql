-- AlterTable
ALTER TABLE "SurveillanceConfig" ADD COLUMN IF NOT EXISTS "alertTelegram" BOOLEAN NOT NULL DEFAULT true;
