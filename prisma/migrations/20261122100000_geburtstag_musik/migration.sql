-- Musik unter der Geburtstags-Ansage
ALTER TABLE "RiderBirthday" ADD COLUMN "announceMusicTrackId" INTEGER;

ALTER TABLE "RiderBirthday" ADD CONSTRAINT "RiderBirthday_announceMusicTrackId_fkey" FOREIGN KEY ("announceMusicTrackId") REFERENCES "AudioTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
