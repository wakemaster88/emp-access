-- AlterTable
ALTER TABLE "AllowedVehicle" ADD COLUMN IF NOT EXISTS "notifyOnDetection" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VehicleSighting" ADD COLUMN IF NOT EXISTS "snapshot" BYTEA;
