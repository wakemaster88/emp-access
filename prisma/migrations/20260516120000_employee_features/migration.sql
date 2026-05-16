-- Mitarbeiter-Features: direkter Geraete-Zugang + Wochenplan pro Ticket.
-- IF NOT EXISTS-Wrapper, damit ein zweites `migrate deploy` (z. B. nach
-- Branch-Wechsel auf einer bereits gepatchten DB) harmlos bleibt.

-- Per-Ticket Wochenplan (gleiche Form wie Device.schedule, optional).
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "weekSchedule" JSONB;

-- TicketDevice = additive Direkt-Zuordnung Ticket -> Device.
CREATE TABLE IF NOT EXISTS "TicketDevice" (
  "id"        SERIAL PRIMARY KEY,
  "ticketId"  INTEGER NOT NULL,
  "deviceId"  INTEGER NOT NULL,
  CONSTRAINT "TicketDevice_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE,
  CONSTRAINT "TicketDevice_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TicketDevice_ticketId_deviceId_key"
  ON "TicketDevice"("ticketId", "deviceId");
CREATE INDEX IF NOT EXISTS "TicketDevice_ticketId_idx"
  ON "TicketDevice"("ticketId");
CREATE INDEX IF NOT EXISTS "TicketDevice_deviceId_idx"
  ON "TicketDevice"("deviceId");
