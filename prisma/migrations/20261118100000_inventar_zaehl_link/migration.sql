-- Zähl-Link fürs Handy je Inventar-Blatt, Fotos für Inventar
ALTER TABLE "InventoryAsset" ADD COLUMN "image" TEXT;
ALTER TABLE "InventoryAssetCount" ADD COLUMN "countedBy" TEXT;

CREATE TABLE "InventoryCountLink" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "group" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryCountLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryCountLink_token_key" ON "InventoryCountLink"("token");
CREATE UNIQUE INDEX "InventoryCountLink_accountId_group_key" ON "InventoryCountLink"("accountId", "group");
ALTER TABLE "InventoryCountLink" ADD CONSTRAINT "InventoryCountLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
