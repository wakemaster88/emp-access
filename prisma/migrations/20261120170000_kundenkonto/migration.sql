-- Kundenkonto je E-Mail-Adresse, Personen mit eigenem Namen und Geburtsdatum.
-- Nur neue Tabelle und Spalten; die Zuordnung der Bestandsdaten macht die App
-- (src/lib/customers.ts, Cron tick-5min).
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "annyCustomerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Customer_accountId_email_key" ON "Customer"("accountId", "email");
CREATE INDEX "Customer_accountId_idx" ON "Customer"("accountId");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Ticket" ADD COLUMN "customerId" INTEGER;
CREATE INDEX "Ticket_customerId_idx" ON "Ticket"("customerId");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RiderProfile" ADD COLUMN "customerId" INTEGER;
ALTER TABLE "RiderProfile" ADD COLUMN "firstName" TEXT;
ALTER TABLE "RiderProfile" ADD COLUMN "lastName" TEXT;
ALTER TABLE "RiderProfile" ADD COLUMN "birthDate" TIMESTAMP(3);
CREATE INDEX "RiderProfile_customerId_idx" ON "RiderProfile"("customerId");
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
