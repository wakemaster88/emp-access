-- Locker.subscriptionId → Locker.ticketId: Schließfach gehört direkt zu einem
-- konkreten Abo-Ticket (Mieter), nicht zur Abo-Definition. 1 Ticket → n Locker.
-- Beim Löschen des Tickets: Schließfach bleibt erhalten (ticketId wird NULL).

ALTER TABLE "Locker" ADD COLUMN IF NOT EXISTS "ticketId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Locker_ticketId_fkey'
  ) THEN
    ALTER TABLE "Locker" ADD CONSTRAINT "Locker_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Locker_ticketId_idx" ON "Locker"("ticketId");

-- Alte Subscription-Verknüpfung entfernen (keine Daten-Migration: Schließfächer
-- werden manuell neu zugeordnet, da das Ziel-Ticket nicht eindeutig ableitbar ist).
ALTER TABLE "Locker" DROP CONSTRAINT IF EXISTS "Locker_subscriptionId_fkey";
DROP INDEX IF EXISTS "Locker_subscriptionId_idx";
ALTER TABLE "Locker" DROP COLUMN IF EXISTS "subscriptionId";
