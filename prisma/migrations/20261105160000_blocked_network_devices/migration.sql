-- Sperrliste fuer Geraete im Netz (Sperren/Freigeben auf der Netzwerk-Seite).
-- Die eigentliche Sperre steht in NETGEAR Insight (MAC ACL); der Hub-Scan
-- meldet, wenn eine gesperrte MAC wieder auftaucht.

CREATE TABLE "BlockedNetworkDevice" (
    "id" SERIAL NOT NULL,
    "macAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "enforcedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastSeenIp" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" INTEGER NOT NULL,

    CONSTRAINT "BlockedNetworkDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlockedNetworkDevice_accountId_macAddress_key" ON "BlockedNetworkDevice"("accountId", "macAddress");

ALTER TABLE "BlockedNetworkDevice" ADD CONSTRAINT "BlockedNetworkDevice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
