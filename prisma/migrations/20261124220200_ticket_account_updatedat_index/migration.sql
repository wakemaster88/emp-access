-- Eigene Migration mit genau einer Anweisung: CONCURRENTLY laeuft nur ausserhalb einer Transaktion und sperrt Schreibzugriffe nicht.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Ticket_accountId_updatedAt_idx" ON "Ticket"("accountId", "updatedAt");
