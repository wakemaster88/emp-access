-- Regeln je Raum. Loest ShellyGroup/ShellyAutomation ab: Raumbezug,
-- Betriebszeit als Ausloeser und Bedingung, mehrere Aktionen je Regel
-- (Geraet, Benachrichtigung, Audio).

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleTrigger') THEN
    CREATE TYPE "RuleTrigger" AS ENUM (
      'TIME', 'OPENING', 'CLOSING', 'SUNRISE', 'SUNSET',
      'MOTION', 'DEVICE_SWITCHED', 'SCAN', 'IDLE'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleOperatingCondition') THEN
    CREATE TYPE "RuleOperatingCondition" AS ENUM ('ANY', 'OPEN', 'CLOSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleActionKind') THEN
    CREATE TYPE "RuleActionKind" AS ENUM ('DEVICE', 'NOTIFY', 'AUDIO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleNotifyChannel') THEN
    CREATE TYPE "RuleNotifyChannel" AS ENUM ('TELEGRAM', 'PUSH', 'BOTH');
  END IF;
END $$;

-- ── RoomRule ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RoomRule" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "roomId" INTEGER,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "trigger" "RuleTrigger" NOT NULL,
  "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
  "timeOfDay" TEXT,
  "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
  "cameraId" INTEGER,
  "eventType" TEXT,
  "triggerDeviceId" INTEGER,
  "triggerAction" TEXT,
  "areaId" INTEGER,
  "scanDirection" TEXT,
  "idleMinutes" INTEGER,
  "operating" "RuleOperatingCondition" NOT NULL DEFAULT 'ANY',
  "operatingScheduleId" INTEGER,
  "windowStart" TEXT,
  "windowEnd" TEXT,
  "onlyWhenDark" BOOLEAN NOT NULL DEFAULT false,
  "cooldownSeconds" INTEGER NOT NULL DEFAULT 60,
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoomRule_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomRule_roomId_fkey" FOREIGN KEY ("roomId")
    REFERENCES "KeyRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomRule_cameraId_fkey" FOREIGN KEY ("cameraId")
    REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RoomRule_triggerDeviceId_fkey" FOREIGN KEY ("triggerDeviceId")
    REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomRule_areaId_fkey" FOREIGN KEY ("areaId")
    REFERENCES "AccessArea"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RoomRule_operatingScheduleId_fkey" FOREIGN KEY ("operatingScheduleId")
    REFERENCES "OperatingSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RoomRule_accountId_idx" ON "RoomRule"("accountId");
CREATE INDEX IF NOT EXISTS "RoomRule_accountId_trigger_isActive_idx"
  ON "RoomRule"("accountId", "trigger", "isActive");
CREATE INDEX IF NOT EXISTS "RoomRule_roomId_idx" ON "RoomRule"("roomId");
CREATE INDEX IF NOT EXISTS "RoomRule_cameraId_idx" ON "RoomRule"("cameraId");
CREATE INDEX IF NOT EXISTS "RoomRule_triggerDeviceId_idx" ON "RoomRule"("triggerDeviceId");
CREATE INDEX IF NOT EXISTS "RoomRule_areaId_idx" ON "RoomRule"("areaId");
CREATE INDEX IF NOT EXISTS "RoomRule_operatingScheduleId_idx" ON "RoomRule"("operatingScheduleId");

-- ── RoomRuleAction ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RoomRuleAction" (
  "id" SERIAL PRIMARY KEY,
  "ruleId" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "kind" "RuleActionKind" NOT NULL,
  "deviceId" INTEGER,
  "deviceAction" TEXT,
  "timerSeconds" INTEGER,
  "channel" "RuleNotifyChannel",
  "message" TEXT,
  "audioZoneId" INTEGER,
  "audioAnnouncementId" INTEGER,
  "audioPlaylistId" INTEGER,
  CONSTRAINT "RoomRuleAction_ruleId_fkey" FOREIGN KEY ("ruleId")
    REFERENCES "RoomRule"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomRuleAction_deviceId_fkey" FOREIGN KEY ("deviceId")
    REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomRuleAction_audioZoneId_fkey" FOREIGN KEY ("audioZoneId")
    REFERENCES "AudioZone"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomRuleAction_audioAnnouncementId_fkey" FOREIGN KEY ("audioAnnouncementId")
    REFERENCES "AudioAnnouncement"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RoomRuleAction_audioPlaylistId_fkey" FOREIGN KEY ("audioPlaylistId")
    REFERENCES "AudioPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RoomRuleAction_ruleId_idx" ON "RoomRuleAction"("ruleId");
CREATE INDEX IF NOT EXISTS "RoomRuleAction_deviceId_idx" ON "RoomRuleAction"("deviceId");
CREATE INDEX IF NOT EXISTS "RoomRuleAction_audioZoneId_idx" ON "RoomRuleAction"("audioZoneId");

-- ── RoomRuleRun ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RoomRuleRun" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "ruleId" INTEGER,
  "ruleName" TEXT NOT NULL,
  "roomId" INTEGER,
  "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "triggerKind" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "details" JSONB,
  "durationMs" INTEGER,
  "errorMessage" TEXT,
  CONSTRAINT "RoomRuleRun_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomRuleRun_ruleId_fkey" FOREIGN KEY ("ruleId")
    REFERENCES "RoomRule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RoomRuleRun_accountId_triggeredAt_idx"
  ON "RoomRuleRun"("accountId", "triggeredAt");
CREATE INDEX IF NOT EXISTS "RoomRuleRun_ruleId_idx" ON "RoomRuleRun"("ruleId");

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Aktionen tragen keinen accountId: sie haengen per Cascade an der Regel.
ALTER TABLE "RoomRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoomRuleRun" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['RoomRule', 'RoomRuleRun'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL USING ("accountId" = current_setting(''app.current_tenant_id'', TRUE)::int)',
        t
      );
    END IF;
  END LOOP;
END $$;
