-- Playlist-Abstimmung: auch Webradio-Sender stehen zur Wahl. Optionen als
-- "p<id>" (Playlist) bzw. "s<id>" (Webradio).
ALTER TABLE "GamificationConfig" ADD COLUMN "musicVoteOptions" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "GamificationConfig"
  SET "musicVoteOptions" = ARRAY(SELECT 'p' || x FROM unnest("musicVotePlaylistIds") WITH ORDINALITY AS t(x, n) ORDER BY n);
ALTER TABLE "GamificationConfig" DROP COLUMN "musicVotePlaylistIds";

ALTER TABLE "RiderMusicVote" ADD COLUMN "option" TEXT;
UPDATE "RiderMusicVote" SET "option" = 'p' || "playlistId";
ALTER TABLE "RiderMusicVote" ALTER COLUMN "option" SET NOT NULL;
ALTER TABLE "RiderMusicVote" DROP COLUMN "playlistId";
