-- Ruhezeit der Audio-Zone durch die Betriebszeit abgeloest.
--
-- Bisher hielt jede Zone ein festes Fenster "keine Musik von 22:00 bis 08:00".
-- Jetzt richtet sich die Musik nach der Betriebszeit des Raums: von
-- Betriebsbeginn bis Betriebsende, je Ende mit Versatz in Minuten. Saison,
-- Wochentage und Ausnahmetage kommen damit aus einer Quelle.
--
-- Zonen, die eine Ruhezeit hatten, wollten die Musik begrenzen – sie
-- bekommen die Kopplung eingeschaltet (Versatz 0). Ohne Raum mit Betriebszeit
-- wirkt sie nicht; der Zonen-Dialog weist darauf hin.

ALTER TABLE "AudioZone"
  ADD COLUMN "musicOperating" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "musicOpenOffset" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "musicCloseOffset" INTEGER NOT NULL DEFAULT 0;

UPDATE "AudioZone"
  SET "musicOperating" = true
  WHERE "quietFrom" IS NOT NULL AND "quietTo" IS NOT NULL AND "quietFrom" <> "quietTo";

ALTER TABLE "AudioZone"
  DROP COLUMN "quietFrom",
  DROP COLUMN "quietTo";
