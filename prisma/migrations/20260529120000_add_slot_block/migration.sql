-- SlotBlock: manuelle Slot-Sperre vom Shop-/Check-in-Monitor. Belegt beim
-- Anlegen die volle Restkapazitaet in ANNY (annyBookingIds) und storniert
-- diese beim Aufheben.

CREATE TABLE IF NOT EXISTS "SlotBlock" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "serviceId" INTEGER,
  "serviceName" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "slotStart" TEXT NOT NULL,
  "slotEnd" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT,
  "annyBookingIds" TEXT,
  "annyOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SlotBlock_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SlotBlock_serviceId_fkey" FOREIGN KEY ("serviceId")
    REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SlotBlock_accountId_date_idx"
  ON "SlotBlock"("accountId", "date");

CREATE INDEX IF NOT EXISTS "SlotBlock_serviceId_date_slotStart_idx"
  ON "SlotBlock"("serviceId", "date", "slotStart");
