-- Gamification Etappe 5: Anmeldung an der Kunden-App mit Passwort oder Passkey.
ALTER TABLE "RiderProfile" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "RiderProfile" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RiderProfile" ADD COLUMN "loginFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RiderProfile" ADD COLUMN "loginLockedUntil" TIMESTAMP(3);

CREATE TABLE "RiderPasskey" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiderPasskey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiderPasskey_credentialId_key" ON "RiderPasskey"("credentialId");
CREATE INDEX "RiderPasskey_profileId_idx" ON "RiderPasskey"("profileId");
CREATE INDEX "RiderPasskey_accountId_idx" ON "RiderPasskey"("accountId");
ALTER TABLE "RiderPasskey" ADD CONSTRAINT "RiderPasskey_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderPasskey" ADD CONSTRAINT "RiderPasskey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
