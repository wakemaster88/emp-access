-- MonitorAnnouncement: Kurznachricht vom Shop-Monitor an alle Public-Monitore.
-- Sichtbar im Banner bis manuell dismissed (dismissedAt != null).

CREATE TABLE IF NOT EXISTS "MonitorAnnouncement" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "message" TEXT NOT NULL,
  "sourceLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dismissedAt" TIMESTAMP(3),
  CONSTRAINT "MonitorAnnouncement_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MonitorAnnouncement_accountId_dismissedAt_idx"
  ON "MonitorAnnouncement"("accountId", "dismissedAt");
