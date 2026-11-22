-- Bändchen am Kunden: Chip (Code, Eigentum, Person) und sein Verlauf.
-- Nur neue Tabellen; Ticket.rfidCode bleibt, wie er ist. Die Übernahme der
-- Bestandschips macht scripts/chips-altbestand.ts.
CREATE TYPE "ChipOwner" AS ENUM ('KUNDE', 'BETRIEB', 'MITARBEITER');

CREATE TABLE "Chip" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "owner" "ChipOwner" NOT NULL DEFAULT 'KUNDE',
    "riderProfileId" INTEGER,
    "blockedAt" TIMESTAMP(3),
    "note" TEXT,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Chip_accountId_code_key" ON "Chip"("accountId", "code");
CREATE INDEX "Chip_accountId_idx" ON "Chip"("accountId");
CREATE INDEX "Chip_riderProfileId_idx" ON "Chip"("riderProfileId");
ALTER TABLE "Chip" ADD CONSTRAINT "Chip_riderProfileId_fkey" FOREIGN KEY ("riderProfileId") REFERENCES "RiderProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Chip" ADD CONSTRAINT "Chip_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChipEvent" (
    "id" SERIAL NOT NULL,
    "chipId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "riderProfileId" INTEGER,
    "ticketId" INTEGER,
    "source" TEXT,
    "note" TEXT,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChipEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChipEvent_chipId_idx" ON "ChipEvent"("chipId");
CREATE INDEX "ChipEvent_accountId_idx" ON "ChipEvent"("accountId");
ALTER TABLE "ChipEvent" ADD CONSTRAINT "ChipEvent_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "Chip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChipEvent" ADD CONSTRAINT "ChipEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
