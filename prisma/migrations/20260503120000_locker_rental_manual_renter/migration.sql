-- Schließfach-Vermietung: optional manueller Mietername statt Abo-Ticket.
--
-- 1) ticketId nullable machen, sodass eine Vermietung auch ohne verknuepftes
--    Ticket existieren kann.
ALTER TABLE "LockerRental" ALTER COLUMN "ticketId" DROP NOT NULL;

-- 2) renterName-Spalte fuer manuell eingetragene Mieter hinzufuegen.
ALTER TABLE "LockerRental" ADD COLUMN IF NOT EXISTS "renterName" TEXT;

-- 3) FK-Verhalten anpassen: Wird das verknuepfte Ticket geloescht, soll die
--    Vermietung als Historie erhalten bleiben (nicht mehr CASCADE).
ALTER TABLE "LockerRental" DROP CONSTRAINT IF EXISTS "LockerRental_ticketId_fkey";
ALTER TABLE "LockerRental" ADD CONSTRAINT "LockerRental_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
