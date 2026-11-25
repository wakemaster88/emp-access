-- Güte des Gesichts je Sichtung, vom Hub mit dem Upload geschickt: Größe in
-- dem Bild, aus dem das Merkmal stammt, hochgerechnet ja/nein, Sicherheit des Detektors,
-- Abstand zur zweitbesten Person der Galerie. Das automatische Dazulernen
-- (lib/face-clusters.ts shouldAutoLearn) und die Zuordnung von Hand lesen sie.
-- Rein additiv und nullable: bisherige Sichtungen und Sichtungen eines
-- älteren Hubs bleiben null, älterer Code arbeitet unverändert weiter.
ALTER TABLE "PersonSighting" ADD COLUMN IF NOT EXISTS "faceSize" DOUBLE PRECISION;
ALTER TABLE "PersonSighting" ADD COLUMN IF NOT EXISTS "faceUpscaled" BOOLEAN;
ALTER TABLE "PersonSighting" ADD COLUMN IF NOT EXISTS "faceDetScore" DOUBLE PRECISION;
ALTER TABLE "PersonSighting" ADD COLUMN IF NOT EXISTS "faceMargin" DOUBLE PRECISION;
