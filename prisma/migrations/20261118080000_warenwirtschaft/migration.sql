-- Warenwirtschaft: Artikel, Inventuren (laufend und Stichtag) und Inventarverzeichnis.
-- CreateEnum
CREATE TYPE "StocktakeKind" AS ENUM ('ROLLING', 'CUTOFF');

-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "Article" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Sonstiges',
    "unit" TEXT,
    "supplier" TEXT,
    "purchasePriceCents" INTEGER,
    "stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "image" TEXT,
    "imageSource" TEXT,
    "imageSearchedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stocktake" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "kind" "StocktakeKind" NOT NULL,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StocktakeLine" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "stocktakeId" INTEGER NOT NULL,
    "articleId" INTEGER,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT NOT NULL,
    "unit" TEXT,
    "purchasePriceCents" INTEGER,
    "expected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "counted" DOUBLE PRECISION,
    "broken" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StocktakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAsset" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "location" TEXT,
    "deviceNumber" TEXT,
    "lastInspection" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAssetCount" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "assetId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAssetCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Article_accountId_category_idx" ON "Article"("accountId", "category");

-- CreateIndex
CREATE INDEX "Article_accountId_active_idx" ON "Article"("accountId", "active");

-- CreateIndex
CREATE INDEX "Stocktake_accountId_kind_date_idx" ON "Stocktake"("accountId", "kind", "date");

-- CreateIndex
CREATE INDEX "StocktakeLine_accountId_idx" ON "StocktakeLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "StocktakeLine_stocktakeId_articleId_key" ON "StocktakeLine"("stocktakeId", "articleId");

-- CreateIndex
CREATE INDEX "InventoryAsset_accountId_group_idx" ON "InventoryAsset"("accountId", "group");

-- CreateIndex
CREATE INDEX "InventoryAssetCount_accountId_year_idx" ON "InventoryAssetCount"("accountId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAssetCount_assetId_year_key" ON "InventoryAssetCount"("assetId", "year");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAssetCount" ADD CONSTRAINT "InventoryAssetCount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAssetCount" ADD CONSTRAINT "InventoryAssetCount_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InventoryAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

