-- AlterEnum
ALTER TYPE "AutomationTrigger" ADD VALUE 'CAMERA_EVENT';

-- AlterTable
ALTER TABLE "ShellyAutomation" ADD COLUMN "cameraId" INTEGER,
ADD COLUMN "eventType" TEXT,
ADD COLUMN "windowStart" TEXT,
ADD COLUMN "windowEnd" TEXT,
ADD COLUMN "cooldownMinutes" INTEGER NOT NULL DEFAULT 5;

-- AddForeignKey
ALTER TABLE "ShellyAutomation" ADD CONSTRAINT "ShellyAutomation_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ShellyAutomation_cameraId_idx" ON "ShellyAutomation"("cameraId");
