-- Passkeys (WebAuthn) als zusaetzliche Anmeldung fuer Admins.
CREATE TABLE IF NOT EXISTS "Passkey" (
  "id" SERIAL PRIMARY KEY,
  "adminId" INTEGER NOT NULL,
  "credentialId" TEXT NOT NULL,
  "publicKey" BYTEA NOT NULL,
  "counter" INTEGER NOT NULL DEFAULT 0,
  "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "deviceType" TEXT NOT NULL,
  "backedUp" BOOLEAN NOT NULL DEFAULT false,
  "name" TEXT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Passkey_adminId_fkey" FOREIGN KEY ("adminId")
    REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Passkey_credentialId_key" ON "Passkey"("credentialId");
CREATE INDEX IF NOT EXISTS "Passkey_adminId_idx" ON "Passkey"("adminId");

-- Einmal-Challenges fuer Registrierung und Anmeldung (laufen nach 5 Minuten ab).
CREATE TABLE IF NOT EXISTS "PasskeyChallenge" (
  "id" SERIAL PRIMARY KEY,
  "challenge" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "adminId" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PasskeyChallenge_challenge_key" ON "PasskeyChallenge"("challenge");
CREATE INDEX IF NOT EXISTS "PasskeyChallenge_expiresAt_idx" ON "PasskeyChallenge"("expiresAt");
