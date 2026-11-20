-- Digitale Bestätigung der Inventur (Zähler und Schreiber) und Protokoll.
CREATE TYPE "StocktakeRole" AS ENUM ('COUNTER', 'WRITER');

CREATE TABLE "StocktakeSignature" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "stocktakeId" INTEGER NOT NULL,
    "role" "StocktakeRole" NOT NULL,
    "adminId" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "method" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StocktakeSignature_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StocktakeEvent" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "stocktakeId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "lineId" INTEGER,
    "lineName" TEXT,
    "field" TEXT,
    "oldValue" DOUBLE PRECISION,
    "newValue" DOUBLE PRECISION,
    "actor" TEXT NOT NULL,
    "adminId" INTEGER,
    "via" TEXT NOT NULL DEFAULT 'app',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StocktakeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StocktakeSignature_stocktakeId_role_key" ON "StocktakeSignature"("stocktakeId", "role");
CREATE INDEX "StocktakeSignature_accountId_idx" ON "StocktakeSignature"("accountId");
CREATE INDEX "StocktakeEvent_stocktakeId_createdAt_idx" ON "StocktakeEvent"("stocktakeId", "createdAt");
CREATE INDEX "StocktakeEvent_accountId_idx" ON "StocktakeEvent"("accountId");

ALTER TABLE "StocktakeSignature" ADD CONSTRAINT "StocktakeSignature_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StocktakeSignature" ADD CONSTRAINT "StocktakeSignature_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StocktakeSignature" ADD CONSTRAINT "StocktakeSignature_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StocktakeEvent" ADD CONSTRAINT "StocktakeEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StocktakeEvent" ADD CONSTRAINT "StocktakeEvent_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
