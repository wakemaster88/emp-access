-- Zähl-Link fürs Handy
ALTER TABLE "Stocktake" ADD COLUMN "countToken" TEXT;
ALTER TABLE "Stocktake" ADD COLUMN "countTokenExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Stocktake_countToken_key" ON "Stocktake"("countToken");
ALTER TABLE "StocktakeLine" ADD COLUMN "countedBy" TEXT;
