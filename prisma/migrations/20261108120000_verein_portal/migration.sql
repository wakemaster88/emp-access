-- Vereinsportal: Vereine buchen selbst Slots ueber einen geheimen Link.
-- Buchungen sperren den Slot in ANNY (SlotBlock), geben den Mitgliedern
-- Zutritt (Zutritts-Ticket) und werden spaeter abgerechnet.

ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalToken" TEXT;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalCancelHours" INTEGER NOT NULL DEFAULT 48;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalHorizonDays" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "billingContact" TEXT;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalLeadMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalTrailMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalDeviceIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Verein" ADD COLUMN IF NOT EXISTS "portalDoorbirdIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
CREATE UNIQUE INDEX IF NOT EXISTS "Verein_portalToken_key" ON "Verein"("portalToken");

CREATE TABLE IF NOT EXISTS "VereinBookableService" (
  "id" SERIAL PRIMARY KEY,
  "vereinId" INTEGER NOT NULL,
  "serviceId" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "VereinBookableService_vereinId_fkey" FOREIGN KEY ("vereinId")
    REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VereinBookableService_serviceId_fkey" FOREIGN KEY ("serviceId")
    REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "VereinBookableService_vereinId_serviceId_key"
  ON "VereinBookableService"("vereinId", "serviceId");
CREATE INDEX IF NOT EXISTS "VereinBookableService_vereinId_idx" ON "VereinBookableService"("vereinId");
CREATE INDEX IF NOT EXISTS "VereinBookableService_serviceId_idx" ON "VereinBookableService"("serviceId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VereinBookingStatus') THEN
    CREATE TYPE "VereinBookingStatus" AS ENUM ('BOOKED', 'CANCELED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "VereinSlotBooking" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "vereinId" INTEGER NOT NULL,
  "serviceId" INTEGER,
  "serviceName" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "slotStart" TEXT NOT NULL,
  "slotEnd" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "status" "VereinBookingStatus" NOT NULL DEFAULT 'BOOKED',
  "bookedBy" TEXT,
  "note" TEXT,
  "canceledAt" TIMESTAMP(3),
  "canceledBy" TEXT,
  "slotBlockId" INTEGER,
  "accessTicketId" INTEGER,
  "billedAt" TIMESTAMP(3),
  "invoiceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VereinSlotBooking_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VereinSlotBooking_vereinId_fkey" FOREIGN KEY ("vereinId")
    REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VereinSlotBooking_serviceId_fkey" FOREIGN KEY ("serviceId")
    REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VereinSlotBooking_slotBlockId_fkey" FOREIGN KEY ("slotBlockId")
    REFERENCES "SlotBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VereinSlotBooking_accessTicketId_fkey" FOREIGN KEY ("accessTicketId")
    REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "VereinSlotBooking_accountId_date_idx" ON "VereinSlotBooking"("accountId", "date");
CREATE INDEX IF NOT EXISTS "VereinSlotBooking_vereinId_date_idx" ON "VereinSlotBooking"("vereinId", "date");
CREATE INDEX IF NOT EXISTS "VereinSlotBooking_serviceId_date_slotStart_idx"
  ON "VereinSlotBooking"("serviceId", "date", "slotStart");
