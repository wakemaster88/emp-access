-- Playlist-Abstimmung in Runden: Wechsel nur am Rundenende, App zeigt den Countdown.
ALTER TABLE "GamificationConfig" ADD COLUMN "musicVoteRoundMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "GamificationConfig" ADD COLUMN "musicVoteRoundAt" TIMESTAMP(3);
