-- Info-Anfragen: Gaeste-Formulare per Email (z. B. Ferienkurs-Infos),
-- Antworten landen in Ticket.guestInfo und werden im Check-in angezeigt.

-- ── Ticket: Antworten aus Info-Anfragen ──────────────────────────────────────
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "guestInfo" JSONB;

-- ── InfoFormTemplate ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InfoFormTemplate" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "introText" TEXT,
  "fields" JSONB NOT NULL,
  "askParticipantName" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InfoFormTemplate_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "InfoFormTemplate_accountId_idx" ON "InfoFormTemplate"("accountId");

-- ── InfoRequest ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InfoRequest" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "templateId" INTEGER NOT NULL,
  "token" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "ticketIds" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InfoRequest_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InfoRequest_templateId_fkey" FOREIGN KEY ("templateId")
    REFERENCES "InfoFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InfoRequest_token_key" ON "InfoRequest"("token");
CREATE INDEX IF NOT EXISTS "InfoRequest_accountId_idx" ON "InfoRequest"("accountId");
CREATE INDEX IF NOT EXISTS "InfoRequest_accountId_status_idx" ON "InfoRequest"("accountId", "status");
CREATE INDEX IF NOT EXISTS "InfoRequest_token_idx" ON "InfoRequest"("token");

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE "InfoFormTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InfoRequest" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'InfoFormTemplate' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "InfoFormTemplate"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'InfoRequest' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "InfoRequest"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
