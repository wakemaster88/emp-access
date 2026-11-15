-- Gamification Etappe 2: Kunden-App (Profil je Person, Ausstieg je Ticket).
CREATE TABLE "RiderProfile" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "nickname" TEXT,
    "showInRanking" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiderProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiderProfile_token_key" ON "RiderProfile"("token");
CREATE INDEX "RiderProfile_accountId_idx" ON "RiderProfile"("accountId");
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Ticket" ADD COLUMN "riderProfileId" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "gamificationOptOut" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Ticket_riderProfileId_idx" ON "Ticket"("riderProfileId");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_riderProfileId_fkey" FOREIGN KEY ("riderProfileId") REFERENCES "RiderProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
