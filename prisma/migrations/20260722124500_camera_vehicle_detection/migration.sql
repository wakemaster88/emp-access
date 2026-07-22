-- AlterTable
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "vehicleDetection" BOOLEAN NOT NULL DEFAULT true;
