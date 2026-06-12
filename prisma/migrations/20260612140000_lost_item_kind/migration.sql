-- Verlustmeldungen: Art (FOUND vs LOST_REPORT) sowie Name und Rückrufnummer des Meldenden.

CREATE TYPE "LostItemKind" AS ENUM ('FOUND', 'LOST_REPORT');

ALTER TABLE "LostItem" ADD COLUMN IF NOT EXISTS "kind" "LostItemKind" NOT NULL DEFAULT 'FOUND';
ALTER TABLE "LostItem" ADD COLUMN IF NOT EXISTS "reporterName" TEXT;
ALTER TABLE "LostItem" ADD COLUMN IF NOT EXISTS "callbackPhone" TEXT;

DROP INDEX IF EXISTS "LostItem_accountId_pickedUp_idx";
CREATE INDEX IF NOT EXISTS "LostItem_accountId_kind_pickedUp_idx"
  ON "LostItem"("accountId", "kind", "pickedUp");
