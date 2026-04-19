-- Locker.ticketId → LockerRental: Vermietung läuft jahresweise.
-- Pro Schließfach + Jahr genau ein Mieter-Ticket; daraus ergibt sich automatisch
-- eine Historie, welcher Mieter ein Schließfach in welchem Jahr hatte.

-- 1) Neue Tabelle LockerRental.
CREATE TABLE IF NOT EXISTS "LockerRental" (
  "id" SERIAL PRIMARY KEY,
  "lockerId" INTEGER NOT NULL,
  "ticketId" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LockerRental_lockerId_fkey" FOREIGN KEY ("lockerId")
    REFERENCES "Locker"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LockerRental_ticketId_fkey" FOREIGN KEY ("ticketId")
    REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "LockerRental_lockerId_year_key" ON "LockerRental"("lockerId", "year");
CREATE INDEX IF NOT EXISTS "LockerRental_lockerId_idx" ON "LockerRental"("lockerId");
CREATE INDEX IF NOT EXISTS "LockerRental_ticketId_idx" ON "LockerRental"("ticketId");
CREATE INDEX IF NOT EXISTS "LockerRental_year_idx" ON "LockerRental"("year");

-- 2) Bestehende ticketId-Werte als Vermietung für das aktuelle Jahr migrieren,
--    damit nichts verloren geht. Konflikte (gleiches Locker+Year) ignorieren.
INSERT INTO "LockerRental" ("lockerId", "ticketId", "year", "createdAt", "updatedAt")
SELECT "id", "ticketId", EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, NOW(), NOW()
FROM "Locker"
WHERE "ticketId" IS NOT NULL
ON CONFLICT ("lockerId", "year") DO NOTHING;

-- 3) Alte ticketId-Spalte aus Locker entfernen.
ALTER TABLE "Locker" DROP CONSTRAINT IF EXISTS "Locker_ticketId_fkey";
DROP INDEX IF EXISTS "Locker_ticketId_idx";
ALTER TABLE "Locker" DROP COLUMN IF EXISTS "ticketId";
