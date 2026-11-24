-- Eigene Migration mit genau einer Anweisung: CONCURRENTLY laeuft nur ausserhalb einer Transaktion und sperrt Schreibzugriffe nicht.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Ticket_accountId_annyResourceId_idx" ON "Ticket"("accountId", "annyResourceId");
