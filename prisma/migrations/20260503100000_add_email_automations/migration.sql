-- Email-Automation: Konfiguration, Regeln, Versand-Log + Erweiterungen für
-- Ticket (email) und Voucher (Rabatt-Felder).

-- ── Ticket: optionales Email-Feld ───────────────────────────────────────────
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "email" TEXT;

-- ── Voucher: Rabatt-/Verfalls-Felder ───────────────────────────────────────
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "discountPercent" INTEGER;
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "notes" TEXT;
CREATE INDEX IF NOT EXISTS "Voucher_accountId_expiresAt_idx" ON "Voucher"("accountId", "expiresAt");

-- ── EmailConfig (1:1 Account) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailConfig" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'RESEND',
  "apiKey" TEXT,
  "fromEmail" TEXT NOT NULL,
  "fromName" TEXT,
  "replyTo" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "brandColor" TEXT,
  "logoUrl" TEXT,
  "websiteUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailConfig_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmailConfig_accountId_key" ON "EmailConfig"("accountId");
CREATE INDEX IF NOT EXISTS "EmailConfig_accountId_idx" ON "EmailConfig"("accountId");

-- ── EmailRuleTrigger Enum ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EmailRuleTrigger') THEN
    CREATE TYPE "EmailRuleTrigger" AS ENUM (
      'SUBSCRIPTION_EXPIRING',
      'SUBSCRIPTION_EXPIRED',
      'DAY_VISIT_FOLLOWUP',
      'TICKET_WELCOME'
    );
  END IF;
END $$;

-- ── EmailRule ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailRule" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "trigger" "EmailRuleTrigger" NOT NULL,
  "daysOffset" INTEGER NOT NULL DEFAULT 0,
  "subscriptionId" INTEGER,
  "serviceId" INTEGER,
  "subject" TEXT NOT NULL,
  "bodyHtml" TEXT NOT NULL,
  "createVoucher" BOOLEAN NOT NULL DEFAULT false,
  "voucherDiscountPercent" INTEGER,
  "voucherValidDays" INTEGER,
  "voucherTicketTypeName" TEXT,
  "renewUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "cooldownDays" INTEGER NOT NULL DEFAULT 30,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailRule_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EmailRule_accountId_idx" ON "EmailRule"("accountId");
CREATE INDEX IF NOT EXISTS "EmailRule_accountId_isActive_idx" ON "EmailRule"("accountId", "isActive");
CREATE INDEX IF NOT EXISTS "EmailRule_trigger_isActive_idx" ON "EmailRule"("trigger", "isActive");

-- ── EmailSend ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailSend" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "ruleId" INTEGER,
  "ticketId" INTEGER,
  "voucherId" INTEGER,
  "to" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailSend_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmailSend_ruleId_fkey" FOREIGN KEY ("ruleId")
    REFERENCES "EmailRule"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EmailSend_ticketId_fkey" FOREIGN KEY ("ticketId")
    REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EmailSend_voucherId_fkey" FOREIGN KEY ("voucherId")
    REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EmailSend_accountId_sentAt_idx" ON "EmailSend"("accountId", "sentAt");
CREATE INDEX IF NOT EXISTS "EmailSend_ticketId_idx" ON "EmailSend"("ticketId");
CREATE INDEX IF NOT EXISTS "EmailSend_ruleId_idx" ON "EmailSend"("ruleId");
CREATE INDEX IF NOT EXISTS "EmailSend_accountId_ruleId_ticketId_idx" ON "EmailSend"("accountId", "ruleId", "ticketId");

-- ── Row Level Security für die neuen tenant-scoped Tabellen ────────────────
ALTER TABLE "EmailConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailSend" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'EmailConfig' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "EmailConfig"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'EmailRule' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "EmailRule"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'EmailSend' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "EmailSend"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
