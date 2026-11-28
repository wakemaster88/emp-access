-- PIN fuer EK und Marge im Shop-Monitor (28.11.2026): je Mandant ein
-- bcrypt-Hash und der Zaehler der Fehlversuche. Nur additiv.

CREATE TABLE "ShopCostPin" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCostPin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopCostPin_accountId_key" ON "ShopCostPin"("accountId");

ALTER TABLE "ShopCostPin" ADD CONSTRAINT "ShopCostPin_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
