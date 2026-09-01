-- Schliessanlage: Raum -> Tuer -> Schloss, Schluessel (n:m zu Schloessern),
-- Schluesselprotokoll mit Ausgabe/Ruecknahme und signierbarer Belehrung.

-- ── KeyRoom ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyRoom" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "number" TEXT,
  "building" TEXT,
  "floor" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyRoom_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "KeyRoom_accountId_idx" ON "KeyRoom"("accountId");
CREATE INDEX IF NOT EXISTS "KeyRoom_accountId_building_idx" ON "KeyRoom"("accountId", "building");

-- ── KeyDoor ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyDoor" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "roomId" INTEGER,
  "name" TEXT NOT NULL,
  "doorNumber" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyDoor_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeyDoor_roomId_fkey" FOREIGN KEY ("roomId")
    REFERENCES "KeyRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "KeyDoor_accountId_idx" ON "KeyDoor"("accountId");
CREATE INDEX IF NOT EXISTS "KeyDoor_roomId_idx" ON "KeyDoor"("roomId");

-- ── KeyLock ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyLock" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "doorId" INTEGER NOT NULL,
  "lockNumber" TEXT,
  "lockType" TEXT NOT NULL DEFAULT 'CYLINDER',
  "system" TEXT,
  "manufacturer" TEXT,
  "installedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyLock_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeyLock_doorId_fkey" FOREIGN KEY ("doorId")
    REFERENCES "KeyDoor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "KeyLock_accountId_idx" ON "KeyLock"("accountId");
CREATE INDEX IF NOT EXISTS "KeyLock_doorId_idx" ON "KeyLock"("doorId");

-- ── KeyItem ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyItem" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "keyNumber" TEXT NOT NULL,
  "label" TEXT,
  "level" TEXT NOT NULL DEFAULT 'SINGLE',
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyItem_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KeyItem_accountId_keyNumber_key" ON "KeyItem"("accountId", "keyNumber");
CREATE INDEX IF NOT EXISTS "KeyItem_accountId_idx" ON "KeyItem"("accountId");
CREATE INDEX IF NOT EXISTS "KeyItem_accountId_status_idx" ON "KeyItem"("accountId", "status");

-- ── KeyLockAssignment (n:m) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyLockAssignment" (
  "id" SERIAL PRIMARY KEY,
  "keyId" INTEGER NOT NULL,
  "lockId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeyLockAssignment_keyId_fkey" FOREIGN KEY ("keyId")
    REFERENCES "KeyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeyLockAssignment_lockId_fkey" FOREIGN KEY ("lockId")
    REFERENCES "KeyLock"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KeyLockAssignment_keyId_lockId_key" ON "KeyLockAssignment"("keyId", "lockId");
CREATE INDEX IF NOT EXISTS "KeyLockAssignment_lockId_idx" ON "KeyLockAssignment"("lockId");

-- ── KeyHolder ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyHolder" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "ticketId" INTEGER,
  "firstName" TEXT,
  "lastName" TEXT,
  "company" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyHolder_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeyHolder_ticketId_fkey" FOREIGN KEY ("ticketId")
    REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "KeyHolder_accountId_idx" ON "KeyHolder"("accountId");
CREATE INDEX IF NOT EXISTS "KeyHolder_ticketId_idx" ON "KeyHolder"("ticketId");

-- ── KeyPolicyTemplate ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyPolicyTemplate" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "bodyText" TEXT NOT NULL,
  "liabilityText" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyPolicyTemplate_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KeyPolicyTemplate_accountId_name_version_key"
  ON "KeyPolicyTemplate"("accountId", "name", "version");
CREATE INDEX IF NOT EXISTS "KeyPolicyTemplate_accountId_idx" ON "KeyPolicyTemplate"("accountId");
CREATE INDEX IF NOT EXISTS "KeyPolicyTemplate_accountId_isActive_idx" ON "KeyPolicyTemplate"("accountId", "isActive");

-- ── KeyHandover ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyHandover" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "holderId" INTEGER NOT NULL,
  "policyTemplateId" INTEGER,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedByName" TEXT,
  "dueAt" TIMESTAMP(3),
  "deposit" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'ISSUED',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyHandover_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeyHandover_holderId_fkey" FOREIGN KEY ("holderId")
    REFERENCES "KeyHolder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeyHandover_policyTemplateId_fkey" FOREIGN KEY ("policyTemplateId")
    REFERENCES "KeyPolicyTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "KeyHandover_accountId_idx" ON "KeyHandover"("accountId");
CREATE INDEX IF NOT EXISTS "KeyHandover_accountId_status_idx" ON "KeyHandover"("accountId", "status");
CREATE INDEX IF NOT EXISTS "KeyHandover_holderId_idx" ON "KeyHandover"("holderId");

-- ── KeyHandoverItem ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeyHandoverItem" (
  "id" SERIAL PRIMARY KEY,
  "handoverId" INTEGER NOT NULL,
  "keyId" INTEGER NOT NULL,
  "itemStatus" TEXT NOT NULL DEFAULT 'ISSUED',
  "returnedAt" TIMESTAMP(3),
  "returnedByName" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeyHandoverItem_handoverId_fkey" FOREIGN KEY ("handoverId")
    REFERENCES "KeyHandover"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeyHandoverItem_keyId_fkey" FOREIGN KEY ("keyId")
    REFERENCES "KeyItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KeyHandoverItem_handoverId_keyId_key"
  ON "KeyHandoverItem"("handoverId", "keyId");
CREATE INDEX IF NOT EXISTS "KeyHandoverItem_keyId_idx" ON "KeyHandoverItem"("keyId");

-- ── KeySignature ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KeySignature" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "handoverId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'HANDOVER',
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "policyTemplateId" INTEGER,
  "policySnapshot" JSONB NOT NULL,
  "keySnapshot" JSONB NOT NULL,
  "signedName" TEXT,
  "signatureImage" TEXT,
  "signedAt" TIMESTAMP(3),
  "signerIp" TEXT,
  "signerUserAgent" TEXT,
  "pdf" BYTEA,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeySignature_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeySignature_handoverId_fkey" FOREIGN KEY ("handoverId")
    REFERENCES "KeyHandover"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KeySignature_policyTemplateId_fkey" FOREIGN KEY ("policyTemplateId")
    REFERENCES "KeyPolicyTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KeySignature_token_key" ON "KeySignature"("token");
CREATE INDEX IF NOT EXISTS "KeySignature_accountId_idx" ON "KeySignature"("accountId");
CREATE INDEX IF NOT EXISTS "KeySignature_handoverId_idx" ON "KeySignature"("handoverId");
CREATE INDEX IF NOT EXISTS "KeySignature_token_idx" ON "KeySignature"("token");

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE "KeyRoom" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeyDoor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeyLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeyItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeyHolder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeyPolicyTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeyHandover" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeySignature" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'KeyRoom', 'KeyDoor', 'KeyLock', 'KeyItem', 'KeyHolder',
    'KeyPolicyTemplate', 'KeyHandover', 'KeySignature'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL USING ("accountId" = current_setting(''app.current_tenant_id'', TRUE)::int)',
        t
      );
    END IF;
  END LOOP;
END $$;
