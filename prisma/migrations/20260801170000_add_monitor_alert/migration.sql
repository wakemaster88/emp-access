-- MonitorAlert: Warnung von aussen an den Kassen-/Check-in-Monitor.
-- Aktuell vom lokalen Kamera-Server, wenn an der Drehkreuz-Kamera jemand ohne
-- gueltigen Scan durchgeht. Sichtbar als Popup bis quittiert (acknowledgedAt).

CREATE TABLE IF NOT EXISTS "MonitorAlert" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "source" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  CONSTRAINT "MonitorAlert_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MonitorAlert_accountId_acknowledgedAt_idx"
  ON "MonitorAlert"("accountId", "acknowledgedAt");
