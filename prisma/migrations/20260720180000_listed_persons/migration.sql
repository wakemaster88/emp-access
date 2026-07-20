-- CreateTable
CREATE TABLE "ListedPerson" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "listType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "cameraId" INTEGER,
    "trackHistory" BOOLEAN NOT NULL DEFAULT true,
    "triggerOnDetection" BOOLEAN NOT NULL DEFAULT false,
    "shellyDeviceId" INTEGER,
    "shellyAction" TEXT NOT NULL DEFAULT 'ON',
    "timerSeconds" INTEGER,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 5,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListedPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonSighting" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "cameraId" INTEGER,
    "listedPersonId" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'CAMERA_PERSON',
    "listType" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "shellyTriggered" BOOLEAN NOT NULL DEFAULT false,
    "shellyOk" BOOLEAN,
    "notes" TEXT,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonSighting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListedPerson_accountId_listType_isActive_idx" ON "ListedPerson"("accountId", "listType", "isActive");
CREATE INDEX "ListedPerson_cameraId_idx" ON "ListedPerson"("cameraId");
CREATE INDEX "ListedPerson_shellyDeviceId_idx" ON "ListedPerson"("shellyDeviceId");
CREATE INDEX "PersonSighting_accountId_seenAt_idx" ON "PersonSighting"("accountId", "seenAt");
CREATE INDEX "PersonSighting_cameraId_seenAt_idx" ON "PersonSighting"("cameraId", "seenAt");
CREATE INDEX "PersonSighting_listedPersonId_idx" ON "PersonSighting"("listedPersonId");
CREATE INDEX "PersonSighting_listType_seenAt_idx" ON "PersonSighting"("listType", "seenAt");

-- AddForeignKey
ALTER TABLE "ListedPerson" ADD CONSTRAINT "ListedPerson_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListedPerson" ADD CONSTRAINT "ListedPerson_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListedPerson" ADD CONSTRAINT "ListedPerson_shellyDeviceId_fkey" FOREIGN KEY ("shellyDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonSighting" ADD CONSTRAINT "PersonSighting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonSighting" ADD CONSTRAINT "PersonSighting_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonSighting" ADD CONSTRAINT "PersonSighting_listedPersonId_fkey" FOREIGN KEY ("listedPersonId") REFERENCES "ListedPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
