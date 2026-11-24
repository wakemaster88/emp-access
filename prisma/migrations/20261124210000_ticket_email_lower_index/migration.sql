-- Ticket-Suche nach E-Mail ohne Groß- und Kleinschreibung (lib/ticket-email.ts).
-- Ausdrucks-Index, in schema.prisma nicht darstellbar. Eine einzige Anweisung,
-- damit sie ausserhalb einer Transaktion laeuft (CONCURRENTLY sperrt die
-- Tabelle nicht). Rein additiv: aelterer Code laeuft unveraendert weiter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Ticket_accountId_lower_email_idx" ON "Ticket" ("accountId", lower("email"));
