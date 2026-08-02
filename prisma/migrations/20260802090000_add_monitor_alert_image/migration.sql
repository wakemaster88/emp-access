-- MonitorAlertImage: Bild zum Vorfall (JPEG), damit am Kassen-Monitor
-- erkennbar ist, um wen es geht. Eigene Tabelle, damit das Polling des
-- Monitors die Bilddaten nicht bei jedem Durchlauf mitliest.

CREATE TABLE IF NOT EXISTS "MonitorAlertImage" (
  "id" SERIAL PRIMARY KEY,
  "alertId" INTEGER NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "label" TEXT,
  "image" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitorAlertImage_alertId_fkey" FOREIGN KEY ("alertId")
    REFERENCES "MonitorAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "MonitorAlertImage_alertId_position_key"
  ON "MonitorAlertImage"("alertId", "position");
