-- Doppelter Index: seine Spalten sind der vordere Teil eines anderen
-- Index (oder doppeln eine Unique-Spalte). Eine Anweisung je Migration,
-- weil CONCURRENTLY nicht in einer Transaktion laufen darf; so wartet
-- kein Zugriff auf die Tabelle.
DROP INDEX CONCURRENTLY IF EXISTS "NetworkOutlet_accountId_idx";
