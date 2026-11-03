-- Telegram-Meldung bei neuen Geraeten im Netz.
--
-- KnownNetworkDevice merkt sich jede MAC, die der Hub je gesehen hat (bleibt
-- auch dann bestehen, wenn der DiscoveredDevice-Eintrag aufgeraeumt wird).
-- Beim ersten Scan nach dem Deploy wird der Bestand still uebernommen; danach
-- meldet jede neue MAC einmal per Telegram.

CREATE TABLE "KnownNetworkDevice" (
    "id" SERIAL NOT NULL,
    "macAddress" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" INTEGER NOT NULL,

    CONSTRAINT "KnownNetworkDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnownNetworkDevice_accountId_macAddress_key" ON "KnownNetworkDevice"("accountId", "macAddress");

ALTER TABLE "KnownNetworkDevice" ADD CONSTRAINT "KnownNetworkDevice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramConfig" ADD COLUMN "notifyNewDevices" BOOLEAN NOT NULL DEFAULT true;
