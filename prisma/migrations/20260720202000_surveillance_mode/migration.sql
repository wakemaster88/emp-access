-- CreateTable
CREATE TABLE IF NOT EXISTS "SurveillanceConfig" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "manualArmed" BOOLEAN NOT NULL DEFAULT false,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
    "windowStart" TEXT,
    "windowEnd" TEXT,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 5,
    "alertOnPerson" BOOLEAN NOT NULL DEFAULT true,
    "alertOnVehicle" BOOLEAN NOT NULL DEFAULT true,
    "lastPushByKey" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveillanceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SurveillanceCamera" (
    "configId" INTEGER NOT NULL,
    "cameraId" INTEGER NOT NULL,

    CONSTRAINT "SurveillanceCamera_pkey" PRIMARY KEY ("configId","cameraId")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SurveillanceConfig_accountId_key" ON "SurveillanceConfig"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SurveillanceCamera_cameraId_idx" ON "SurveillanceCamera"("cameraId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SurveillanceConfig" ADD CONSTRAINT "SurveillanceConfig_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SurveillanceCamera" ADD CONSTRAINT "SurveillanceCamera_configId_fkey"
    FOREIGN KEY ("configId") REFERENCES "SurveillanceConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SurveillanceCamera" ADD CONSTRAINT "SurveillanceCamera_cameraId_fkey"
    FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
