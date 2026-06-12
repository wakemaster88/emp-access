-- LostItem: Fundsachen, anlegbar im Backend und am Shop-/Check-in-Monitor.
-- Bild wird als Base64-Data-URL gespeichert (gleiches Muster wie Ticket.profileImage).

CREATE TABLE IF NOT EXISTS "LostItem" (
  "id" SERIAL PRIMARY KEY,
  "description" TEXT NOT NULL,
  "foundDate" TIMESTAMP(3) NOT NULL,
  "image" TEXT,
  "contact" TEXT,
  "pickedUp" BOOLEAN NOT NULL DEFAULT false,
  "pickedUpAt" TIMESTAMP(3),
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LostItem_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "LostItem_accountId_pickedUp_idx"
  ON "LostItem"("accountId", "pickedUp");
