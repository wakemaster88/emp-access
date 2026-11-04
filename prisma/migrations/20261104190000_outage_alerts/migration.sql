-- Ausfall-Meldungen fuer Kameras und Soundweb, Telegram-Schalter und vom Hub gemeldete Befunde.
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "offlineNotifiedAt" TIMESTAMP(3);
ALTER TABLE "SoundwebDevice" ADD COLUMN IF NOT EXISTS "disconnectedAt" TIMESTAMP(3);
ALTER TABLE "SoundwebDevice" ADD COLUMN IF NOT EXISTS "offlineNotifiedAt" TIMESTAMP(3);
ALTER TABLE "TelegramConfig" ADD COLUMN IF NOT EXISTS "notifyOutages" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "HubAlert" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "hubName" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HubAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HubAlert_accountId_key_key" ON "HubAlert"("accountId", "key");
CREATE INDEX IF NOT EXISTS "HubAlert_accountId_source_resolvedAt_idx" ON "HubAlert"("accountId", "source", "resolvedAt");
DO $$ BEGIN
  ALTER TABLE "HubAlert" ADD CONSTRAINT "HubAlert_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Row Level Security
ALTER TABLE "HubAlert" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'HubAlert' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "HubAlert"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
