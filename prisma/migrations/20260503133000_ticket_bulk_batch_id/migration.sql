-- Bulk-Erstellung: jedes Ticket aus einem Bulk-Run bekommt eine gemeinsame
-- bulkBatchId (UUID-String). Damit kann das Backoffice Bulks listen und
-- erneut drucken.

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "bulkBatchId" TEXT;

CREATE INDEX IF NOT EXISTS "Ticket_accountId_bulkBatchId_idx"
  ON "Ticket" ("accountId", "bulkBatchId");
