-- Audio-Modul: Beschallungszonen, Mediathek, Playlists, Durchsagen, Zeitpläne
-- und Job-/Verlaufstabelle. Tenant-scoped mit RLS (gleiches Muster wie die
-- Bewässerungs-Tabellen). IF NOT EXISTS-Guards, damit ein wiederholtes
-- `migrate deploy` harmlos bleibt.

ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'AUDIO_PLAYER';
ALTER TYPE "DeviceCategory" ADD VALUE IF NOT EXISTS 'AUDIO';

DO $$ BEGIN
  CREATE TYPE "AudioSourceKind" AS ENUM ('SILENCE', 'PLAYLIST', 'STREAM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AudioTrackKind" AS ENUM ('MUSIC', 'JINGLE', 'CHIME', 'ANNOUNCEMENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AudioAnnouncementSource" AS ENUM ('TTS', 'FILE', 'LIVE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AudioJobKind" AS ENUM ('ANNOUNCE', 'PLAY', 'STOP', 'VOLUME', 'SYNC_LIBRARY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AudioJobStatus" AS ENUM ('PENDING', 'SENT', 'PLAYING', 'DONE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AudioScheduleAction" AS ENUM ('ANNOUNCE', 'PLAY', 'STOP', 'VOLUME');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── AudioTrack ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AudioTrack" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "artist" TEXT,
  "kind" "AudioTrackKind" NOT NULL DEFAULT 'MUSIC',
  "url" TEXT NOT NULL,
  "blobPathname" TEXT,
  "contentType" TEXT,
  "sizeBytes" INTEGER,
  "durationSec" INTEGER,
  "ttsHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioTrack_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AudioTrack_accountId_ttsHash_key"
  ON "AudioTrack"("accountId", "ttsHash");
CREATE INDEX IF NOT EXISTS "AudioTrack_accountId_kind_idx"
  ON "AudioTrack"("accountId", "kind");

-- ── AudioPlaylist ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AudioPlaylist" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "shuffle" BOOLEAN NOT NULL DEFAULT true,
  "crossfadeSec" INTEGER NOT NULL DEFAULT 3,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioPlaylist_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AudioPlaylist_accountId_idx"
  ON "AudioPlaylist"("accountId");

-- ── AudioPlaylistItem ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AudioPlaylistItem" (
  "id" SERIAL PRIMARY KEY,
  "playlistId" INTEGER NOT NULL,
  "trackId" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AudioPlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId")
    REFERENCES "AudioPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioPlaylistItem_trackId_fkey" FOREIGN KEY ("trackId")
    REFERENCES "AudioTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AudioPlaylistItem_playlistId_sortOrder_idx"
  ON "AudioPlaylistItem"("playlistId", "sortOrder");
CREATE INDEX IF NOT EXISTS "AudioPlaylistItem_trackId_idx"
  ON "AudioPlaylistItem"("trackId");

-- ── AudioZone ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AudioZone" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "deviceId" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "syncGroup" TEXT,
  "volume" INTEGER NOT NULL DEFAULT 50,
  "announcementVolume" INTEGER NOT NULL DEFAULT 85,
  "duckVolume" INTEGER NOT NULL DEFAULT 15,
  "sourceKind" "AudioSourceKind" NOT NULL DEFAULT 'SILENCE',
  "playlistId" INTEGER,
  "streamUrl" TEXT,
  "quietFrom" TEXT,
  "quietTo" TEXT,
  "isPlaying" BOOLEAN NOT NULL DEFAULT false,
  "currentTitle" TEXT,
  "reportedVolume" INTEGER,
  "lastStateAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioZone_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioZone_deviceId_fkey" FOREIGN KEY ("deviceId")
    REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AudioZone_playlistId_fkey" FOREIGN KEY ("playlistId")
    REFERENCES "AudioPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AudioZone_deviceId_key"
  ON "AudioZone"("deviceId");
CREATE INDEX IF NOT EXISTS "AudioZone_accountId_sortOrder_idx"
  ON "AudioZone"("accountId", "sortOrder");
CREATE INDEX IF NOT EXISTS "AudioZone_playlistId_idx"
  ON "AudioZone"("playlistId");

-- ── AudioAnnouncement ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AudioAnnouncement" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "source" "AudioAnnouncementSource" NOT NULL DEFAULT 'TTS',
  "text" TEXT,
  "voice" TEXT,
  "trackId" INTEGER,
  "chime" BOOLEAN NOT NULL DEFAULT true,
  "repeatCount" INTEGER NOT NULL DEFAULT 1,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "zoneIds" JSONB NOT NULL DEFAULT '[]',
  "isTemplate" BOOLEAN NOT NULL DEFAULT false,
  "lastPlayedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioAnnouncement_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioAnnouncement_trackId_fkey" FOREIGN KEY ("trackId")
    REFERENCES "AudioTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AudioAnnouncement_accountId_isTemplate_idx"
  ON "AudioAnnouncement"("accountId", "isTemplate");
CREATE INDEX IF NOT EXISTS "AudioAnnouncement_trackId_idx"
  ON "AudioAnnouncement"("trackId");

-- ── AudioSchedule ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AudioSchedule" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "action" "AudioScheduleAction" NOT NULL,
  "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
  "timeOfDay" TEXT NOT NULL,
  "zoneIds" JSONB NOT NULL DEFAULT '[]',
  "announcementId" INTEGER,
  "playlistId" INTEGER,
  "volume" INTEGER,
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioSchedule_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioSchedule_announcementId_fkey" FOREIGN KEY ("announcementId")
    REFERENCES "AudioAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioSchedule_playlistId_fkey" FOREIGN KEY ("playlistId")
    REFERENCES "AudioPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AudioSchedule_accountId_isActive_idx"
  ON "AudioSchedule"("accountId", "isActive");
CREATE INDEX IF NOT EXISTS "AudioSchedule_announcementId_idx"
  ON "AudioSchedule"("announcementId");
CREATE INDEX IF NOT EXISTS "AudioSchedule_playlistId_idx"
  ON "AudioSchedule"("playlistId");

-- ── AudioJob ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AudioJob" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "zoneId" INTEGER NOT NULL,
  "kind" "AudioJobKind" NOT NULL,
  "status" "AudioJobStatus" NOT NULL DEFAULT 'PENDING',
  "announcementId" INTEGER,
  "payload" JSONB,
  "triggerKind" TEXT NOT NULL DEFAULT 'MANUAL',
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AudioJob_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioJob_zoneId_fkey" FOREIGN KEY ("zoneId")
    REFERENCES "AudioZone"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioJob_announcementId_fkey" FOREIGN KEY ("announcementId")
    REFERENCES "AudioAnnouncement"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AudioJob_accountId_createdAt_idx"
  ON "AudioJob"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "AudioJob_zoneId_status_idx"
  ON "AudioJob"("zoneId", "status");
CREATE INDEX IF NOT EXISTS "AudioJob_announcementId_idx"
  ON "AudioJob"("announcementId");

-- ── Row Level Security ───────────────────────────────────────────────────────
-- AudioPlaylistItem hat keine eigene accountId; die Isolation erfolgt ueber
-- die Playlist, deren Zeile bereits durch die Policy geschuetzt ist.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'AudioTrack', 'AudioPlaylist', 'AudioZone',
    'AudioAnnouncement', 'AudioSchedule', 'AudioJob'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL USING ("accountId" = current_setting(''app.current_tenant_id'', TRUE)::int)',
        t
      );
    END IF;
  END LOOP;
END $$;

ALTER TABLE "AudioPlaylistItem" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'AudioPlaylistItem' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "AudioPlaylistItem"
      FOR ALL USING (EXISTS (
        SELECT 1 FROM "AudioPlaylist" p
        WHERE p."id" = "AudioPlaylistItem"."playlistId"
          AND p."accountId" = current_setting('app.current_tenant_id', TRUE)::int
      ));
  END IF;
END $$;
