-- AlterTable
ALTER TABLE "AllowedVehicle" ADD COLUMN "cameraId" INTEGER;

-- CreateIndex
CREATE INDEX "AllowedVehicle_cameraId_idx" ON "AllowedVehicle"("cameraId");

-- AddForeignKey
ALTER TABLE "AllowedVehicle" ADD CONSTRAINT "AllowedVehicle_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;
