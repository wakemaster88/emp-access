-- Verein (club/association) and VereinArea (m:n bulk-access mapping)
-- Adds Ticket.vereinId so members inherit access to all VereinAreas.

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

CREATE TABLE IF NOT EXISTS "VereinArea" (
  "id" SERIAL PRIMARY KEY,
  "vereinId" INTEGER NOT NULL,
  "accessAreaId" INTEGER NOT NULL,
  CONSTRAINT "VereinArea_vereinId_fkey" FOREIGN KEY ("vereinId")
    REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VereinArea_accessAreaId_fkey" FOREIGN KEY ("accessAreaId")
    REFERENCES "AccessArea"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "VereinArea_vereinId_accessAreaId_key" ON "VereinArea"("vereinId", "accessAreaId");
CREATE INDEX IF NOT EXISTS "VereinArea_vereinId_idx" ON "VereinArea"("vereinId");
CREATE INDEX IF NOT EXISTS "VereinArea_accessAreaId_idx" ON "VereinArea"("accessAreaId");

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
