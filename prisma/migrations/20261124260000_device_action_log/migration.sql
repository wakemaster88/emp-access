-- Protokoll der Geraete-Schaltungen, Token-Aenderungen und Loeschungen.
-- Nur eine neue Tabelle; bestehende Tabellen bleiben, wie sie sind.
-- deviceId ohne Fremdschluessel: Zeilen ueberdauern das Loeschen des Geraets.
CREATE TABLE "DeviceActionLog" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "deviceName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" INTEGER,
    "actorLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceActionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceActionLog_accountId_createdAt_idx" ON "DeviceActionLog"("accountId", "createdAt");
CREATE INDEX "DeviceActionLog_accountId_deviceId_createdAt_idx" ON "DeviceActionLog"("accountId", "deviceId", "createdAt");
ALTER TABLE "DeviceActionLog" ADD CONSTRAINT "DeviceActionLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
