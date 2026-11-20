-- Veranstaltungen: Raeume, Partner, Termine, Zusatzleistungen, Dokumente

-- CreateEnum
CREATE TYPE "VenueExtraUnit" AS ENUM ('FLAT', 'PER_PERSON', 'PER_PIECE');

-- CreateEnum
CREATE TYPE "VenueEventStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'CANCELED');

-- CreateEnum
CREATE TYPE "VenueDocumentKind" AS ENUM ('ORDER_CONFIRMATION', 'DEPOSIT_INVOICE', 'FINAL_INVOICE', 'OTHER');

-- AlterTable
ALTER TABLE "AccessArea" ADD COLUMN     "eventBufferMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "eventCapacity" INTEGER,
ADD COLUMN     "eventVenue" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EventPartner" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "notifyEmail" TEXT,
    "portalToken" TEXT,
    "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "areaIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "editLockHours" INTEGER NOT NULL DEFAULT 48,
    "horizonDays" INTEGER NOT NULL DEFAULT 365,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "EventPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueExtra" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "areaId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "unit" "VenueExtraUnit" NOT NULL DEFAULT 'FLAT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "VenueExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueEvent" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "areaId" INTEGER NOT NULL,
    "partnerId" INTEGER,
    "title" TEXT NOT NULL,
    "hostName" TEXT,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "actualGuests" INTEGER,
    "status" "VenueEventStatus" NOT NULL DEFAULT 'RESERVED',
    "note" TEXT,
    "internalNote" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdByName" TEXT,
    "canceledAt" TIMESTAMP(3),
    "canceledBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "billedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "VenueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueEventExtra" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "extraId" INTEGER,
    "name" TEXT NOT NULL,
    "unit" "VenueExtraUnit" NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

CONSTRAINT "VenueEventExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueEventDocument" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "kind" "VenueDocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "pdfBlob" TEXT,
    "pdf" BYTEA,
    "reference" TEXT,
    "amountCents" INTEGER,
    "uploadedBy" TEXT,
    "viewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "VenueEventDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueEventChange" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,
    "byName" TEXT,
    "summary" TEXT NOT NULL,

CONSTRAINT "VenueEventChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventPartner_portalToken_key" ON "EventPartner"("portalToken");

-- CreateIndex
CREATE INDEX "EventPartner_accountId_idx" ON "EventPartner"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "EventPartner_accountId_name_key" ON "EventPartner"("accountId", "name");

-- CreateIndex
CREATE INDEX "VenueExtra_accountId_areaId_idx" ON "VenueExtra"("accountId", "areaId");

-- CreateIndex
CREATE INDEX "VenueEvent_accountId_areaId_startDate_idx" ON "VenueEvent"("accountId", "areaId", "startDate");

-- CreateIndex
CREATE INDEX "VenueEvent_partnerId_startDate_idx" ON "VenueEvent"("partnerId", "startDate");

-- CreateIndex
CREATE INDEX "VenueEventExtra_eventId_idx" ON "VenueEventExtra"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueEventExtra_eventId_extraId_key" ON "VenueEventExtra"("eventId", "extraId");

-- CreateIndex
CREATE INDEX "VenueEventDocument_accountId_eventId_idx" ON "VenueEventDocument"("accountId", "eventId");

-- CreateIndex
CREATE INDEX "VenueEventChange_eventId_at_idx" ON "VenueEventChange"("eventId", "at");

-- AddForeignKey
ALTER TABLE "EventPartner" ADD CONSTRAINT "EventPartner_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueExtra" ADD CONSTRAINT "VenueExtra_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueExtra" ADD CONSTRAINT "VenueExtra_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "AccessArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueEvent" ADD CONSTRAINT "VenueEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueEvent" ADD CONSTRAINT "VenueEvent_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "AccessArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueEvent" ADD CONSTRAINT "VenueEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "EventPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueEventExtra" ADD CONSTRAINT "VenueEventExtra_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueEventExtra" ADD CONSTRAINT "VenueEventExtra_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "VenueExtra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueEventDocument" ADD CONSTRAINT "VenueEventDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueEventDocument" ADD CONSTRAINT "VenueEventDocument_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueEventChange" ADD CONSTRAINT "VenueEventChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
