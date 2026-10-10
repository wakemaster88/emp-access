-- Musik-Automatik der Audio-Zone als Auswahl statt Schalter.
--
-- Bisher ging die Musik nur ueber die Betriebszeit des Raums von selbst an und
-- aus: Zone -> Raum -> Betriebszeit -> Saison -> Wochenplan. Endete die Saison,
-- blieb die Zone ohne Hinweis stumm. Jetzt waehlt die Zone selbst:
--
-- * MANUAL    keine Automatik (bisher musicOperating = false)
-- * TIMES     eigene Musikzeiten je Wochentag in "musicTimes"
-- * OPERATING Betriebszeit des Raums mit Versatz (bisher musicOperating = true)

CREATE TYPE "AudioMusicMode" AS ENUM ('MANUAL', 'TIMES', 'OPERATING');

ALTER TABLE "AudioZone"
  ADD COLUMN "musicMode" "AudioMusicMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "musicTimes" JSONB NOT NULL DEFAULT '[]';

UPDATE "AudioZone" SET "musicMode" = 'OPERATING' WHERE "musicOperating" = true;

ALTER TABLE "AudioZone" DROP COLUMN "musicOperating";
