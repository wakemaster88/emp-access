-- Playlist-Abstimmung der Fahrer in der Kunden-App (lib/music-vote).
ALTER TABLE "GamificationConfig" ADD COLUMN "musicVoteEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GamificationConfig" ADD COLUMN "musicVoteZoneIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "GamificationConfig" ADD COLUMN "musicVotePlaylistIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "GamificationConfig" ADD COLUMN "musicVoteHoldMinutes" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "AudioZone" ADD COLUMN "staffChoiceAt" TIMESTAMP(3);

CREATE TABLE "RiderMusicVote" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "playlistId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderMusicVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiderMusicVote_profileId_day_key" ON "RiderMusicVote"("profileId", "day");
CREATE INDEX "RiderMusicVote_accountId_day_idx" ON "RiderMusicVote"("accountId", "day");

ALTER TABLE "RiderMusicVote" ADD CONSTRAINT "RiderMusicVote_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderMusicVote" ADD CONSTRAINT "RiderMusicVote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
