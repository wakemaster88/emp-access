-- Passwort-Sperre der Verwaltung je (E-Mail, Client-IP) statt am ganzen Konto,
-- dazu eine Taktung je E-Mail ueber alle IPs.
-- Rein additiv: neue, leere Tabellen. Bestehende Sperren am Admin-Datensatz
-- werden vom neuen Code nicht mehr ausgewertet, sperren also niemanden aus.
-- Gespeichert werden nur Abdruecke von E-Mail und IP (HMAC mit dem
-- Anwendungsschluessel).
CREATE TABLE IF NOT EXISTS "AdminLoginLock" (
  "id" SERIAL PRIMARY KEY,
  "emailHash" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "succeededAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminLoginLock_emailHash_ipHash_key" ON "AdminLoginLock"("emailHash", "ipHash");
CREATE INDEX IF NOT EXISTS "AdminLoginLock_emailHash_lastAttemptAt_idx" ON "AdminLoginLock"("emailHash", "lastAttemptAt");
CREATE INDEX IF NOT EXISTS "AdminLoginLock_lastAttemptAt_idx" ON "AdminLoginLock"("lastAttemptAt");

CREATE TABLE IF NOT EXISTS "AdminLoginPace" (
  "emailHash" TEXT NOT NULL PRIMARY KEY,
  "nextAllowedAt" TIMESTAMP(3) NOT NULL
);
