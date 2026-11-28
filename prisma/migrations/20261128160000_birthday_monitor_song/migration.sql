-- Geburtstagssong beim Scan am Shop-Monitor (additiv, ab Werk aus).
ALTER TABLE "RiderBirthday" ADD COLUMN "monitorSongActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RiderBirthday" ADD COLUMN "monitorSongZoneIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "RiderBirthday" ADD COLUMN "monitorSongTrackId" INTEGER;
ALTER TABLE "RiderBirthdayGift" ADD COLUMN "monitorSongAt" TIMESTAMP(3);

ALTER TABLE "RiderBirthday" ADD CONSTRAINT "RiderBirthday_monitorSongTrackId_fkey" FOREIGN KEY ("monitorSongTrackId") REFERENCES "AudioTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
