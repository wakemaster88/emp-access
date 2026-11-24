-- Eigene Migration mit genau einer Anweisung: CONCURRENTLY laeuft nur ausserhalb einer Transaktion und sperrt Schreibzugriffe nicht.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Scan_ticketId_scanTime_idx" ON "Scan"("ticketId", "scanTime");
