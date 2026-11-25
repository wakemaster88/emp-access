-- Integrations-Tokens mit Scopes fuer angebundene Systeme.
-- Nur eine neue Tabelle; bestehende Tabellen bleiben, wie sie sind.
CREATE TABLE "IntegrationToken" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdByAdminId" INTEGER,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationToken_tokenHash_key" ON "IntegrationToken"("tokenHash");
CREATE INDEX "IntegrationToken_accountId_idx" ON "IntegrationToken"("accountId");
ALTER TABLE "IntegrationToken" ADD CONSTRAINT "IntegrationToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
