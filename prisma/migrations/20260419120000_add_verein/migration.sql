-- Verein (club/association) und VereinAccessTicket (m:n Verein ↔ Zutritts-Ticket)
-- Mitglieder werden über Ticket.vereinId verknüpft. Beim Scan erben sie die
-- Areas aller in VereinAccessTicket verknüpften Tickets (z. B. „Bahnmiete“).

CREATE TABLE IF NOT EXISTS "Verein" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Verein_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Verein_accountId_name_key" ON "Verein"("accountId", "name");
CREATE INDEX IF NOT EXISTS "Verein_accountId_idx" ON "Verein"("accountId");

-- Falls eine alte VereinArea-Tabelle aus früherem db-push existiert: weg damit.
DROP TABLE IF EXISTS "VereinArea";

CREATE TABLE IF NOT EXISTS "VereinAccessTicket" (
  "id" SERIAL PRIMARY KEY,
  "vereinId" INTEGER NOT NULL,
  "ticketId" INTEGER NOT NULL,
  -- Bitmaske: bit0=Mo … bit6=So. 127 = jeden Tag.
  "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
  "slotStart" TEXT,
  "slotEnd" TEXT,
  CONSTRAINT "VereinAccessTicket_vereinId_fkey" FOREIGN KEY ("vereinId")
    REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VereinAccessTicket_ticketId_fkey" FOREIGN KEY ("ticketId")
    REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Idempotent: Spalten nachziehen, falls Tabelle schon existiert (älterer db push).
ALTER TABLE "VereinAccessTicket" ADD COLUMN IF NOT EXISTS "daysOfWeek" INTEGER NOT NULL DEFAULT 127;
ALTER TABLE "VereinAccessTicket" ADD COLUMN IF NOT EXISTS "slotStart" TEXT;
ALTER TABLE "VereinAccessTicket" ADD COLUMN IF NOT EXISTS "slotEnd" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "VereinAccessTicket_vereinId_ticketId_key" ON "VereinAccessTicket"("vereinId", "ticketId");
CREATE INDEX IF NOT EXISTS "VereinAccessTicket_vereinId_idx" ON "VereinAccessTicket"("vereinId");
CREATE INDEX IF NOT EXISTS "VereinAccessTicket_ticketId_idx" ON "VereinAccessTicket"("ticketId");

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "vereinId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Ticket_vereinId_fkey'
  ) THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_vereinId_fkey"
      FOREIGN KEY ("vereinId") REFERENCES "Verein"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Ticket_vereinId_idx" ON "Ticket"("vereinId");
