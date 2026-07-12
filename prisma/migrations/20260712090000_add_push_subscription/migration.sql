-- Web-Push: Subscription-Tabelle + Offline-Tracking-Feld auf Device.

-- ── Device: Offline-Episode-Tracking für Push-Benachrichtigungen ────────────
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "offlineNotifiedAt" TIMESTAMP(3);

-- ── PushSubscription ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" SERIAL PRIMARY KEY,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "adminId" INTEGER,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_accountId_idx" ON "PushSubscription"("accountId");

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'PushSubscription' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "PushSubscription"
      FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);
  END IF;
END $$;
