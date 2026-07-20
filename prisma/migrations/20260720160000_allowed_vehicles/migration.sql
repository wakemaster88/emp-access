-- CreateTable
CREATE TABLE "AllowedVehicle" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "plate" TEXT NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "shellyDeviceId" INTEGER,
    "shellyAction" TEXT NOT NULL DEFAULT 'ON',
    "timerSeconds" INTEGER,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 2,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllowedVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleSighting" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "cameraId" INTEGER,
    "plate" TEXT,
    "plateNormalized" TEXT,
    "allowedVehicleId" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'CAMERA_VEHICLE',
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "shellyTriggered" BOOLEAN NOT NULL DEFAULT false,
    "shellyOk" BOOLEAN,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleSighting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AllowedVehicle_accountId_isActive_idx" ON "AllowedVehicle"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "AllowedVehicle_shellyDeviceId_idx" ON "AllowedVehicle"("shellyDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedVehicle_accountId_plateNormalized_key" ON "AllowedVehicle"("accountId", "plateNormalized");

-- CreateIndex
CREATE INDEX "VehicleSighting_accountId_seenAt_idx" ON "VehicleSighting"("accountId", "seenAt");

-- CreateIndex
CREATE INDEX "VehicleSighting_cameraId_seenAt_idx" ON "VehicleSighting"("cameraId", "seenAt");

-- CreateIndex
CREATE INDEX "VehicleSighting_plateNormalized_idx" ON "VehicleSighting"("plateNormalized");

-- CreateIndex
CREATE INDEX "VehicleSighting_allowedVehicleId_idx" ON "VehicleSighting"("allowedVehicleId");

-- AddForeignKey
ALTER TABLE "AllowedVehicle" ADD CONSTRAINT "AllowedVehicle_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowedVehicle" ADD CONSTRAINT "AllowedVehicle_shellyDeviceId_fkey" FOREIGN KEY ("shellyDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSighting" ADD CONSTRAINT "VehicleSighting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSighting" ADD CONSTRAINT "VehicleSighting_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSighting" ADD CONSTRAINT "VehicleSighting_allowedVehicleId_fkey" FOREIGN KEY ("allowedVehicleId") REFERENCES "AllowedVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
