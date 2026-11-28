-- Audio-Zone folgt der Wiedergabe einer anderen Zone (additiv, ab Werk aus).
ALTER TABLE "AudioZone" ADD COLUMN "followZoneId" INTEGER;
ALTER TABLE "AudioZone" ADD COLUMN "followState" TEXT;

CREATE INDEX "AudioZone_followZoneId_idx" ON "AudioZone"("followZoneId");

ALTER TABLE "AudioZone" ADD CONSTRAINT "AudioZone_followZoneId_fkey" FOREIGN KEY ("followZoneId") REFERENCES "AudioZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
