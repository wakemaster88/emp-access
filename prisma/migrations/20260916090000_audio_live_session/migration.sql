-- Echte Live-Durchsage statt Aufnahme mit anschliessendem Upload.
--
-- Der Browser schickt den Mikrofonton in kurzen Stuecken, die Zonen-Pis holen
-- sie fortlaufend ab und spielen sie sofort ab, bis die Durchsage beendet wird.

ALTER TYPE "AudioJobKind" ADD VALUE 'LIVE';

CREATE TYPE "AudioLiveStatus" AS ENUM ('LIVE', 'ENDED');

CREATE TABLE "AudioLiveSession" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "status" "AudioLiveStatus" NOT NULL DEFAULT 'LIVE',
    "startedByName" TEXT,
    "sampleRate" INTEGER NOT NULL DEFAULT 16000,
    "chime" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "lastChunkAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AudioLiveSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioLiveChunk" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioLiveChunk_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AudioJob" ADD COLUMN "liveSessionId" INTEGER;

CREATE INDEX "AudioLiveSession_accountId_status_idx" ON "AudioLiveSession"("accountId", "status");
CREATE UNIQUE INDEX "AudioLiveChunk_sessionId_seq_key" ON "AudioLiveChunk"("sessionId", "seq");
CREATE INDEX "AudioJob_liveSessionId_idx" ON "AudioJob"("liveSessionId");

ALTER TABLE "AudioLiveSession" ADD CONSTRAINT "AudioLiveSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioLiveChunk" ADD CONSTRAINT "AudioLiveChunk_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AudioLiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioJob" ADD CONSTRAINT "AudioJob_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "AudioLiveSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
