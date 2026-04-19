-- Schließfach (Locker): pro Account verwaltbar, optional an ein Abo (Subscription) gebunden.
-- 1 Abo → n Schließfächer. Beim Löschen des Abos bleibt das Schließfach (subscriptionId wird NULL).

CREATE TABLE IF NOT EXISTS "Locker" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "location" TEXT,
  "number" TEXT NOT NULL,
  "notes" TEXT,
  "subscriptionId" INTEGER,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Locker_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Locker_subscriptionId_fkey" FOREIGN KEY ("subscriptionId")
    REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Locker_accountId_number_key" ON "Locker"("accountId", "number");
CREATE INDEX IF NOT EXISTS "Locker_accountId_idx" ON "Locker"("accountId");
CREATE INDEX IF NOT EXISTS "Locker_subscriptionId_idx" ON "Locker"("subscriptionId");
