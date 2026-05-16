-- Persoenlicher Mobile-PWA-Token pro Mitarbeiter/Ticket.
-- IF NOT EXISTS, damit ein zweiter `migrate deploy` (z. B. nach Branch-
-- Wechsel) harmlos bleibt.

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "mobileToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_mobileToken_key"
  ON "Ticket"("mobileToken");
