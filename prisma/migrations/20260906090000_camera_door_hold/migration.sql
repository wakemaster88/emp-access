-- Tor offen halten (DoorBird): Der Hub loest das Tueroeffner-Relais bis
-- "doorHoldUntil" im Takt erneut aus, weil das Tor sonst nach ~1 min schliesst.
-- Impulszeitpunkt und Fehler meldet der Hub zurueck (Anzeige in der UI).
ALTER TABLE "Camera"
  ADD COLUMN "doorHoldUntil" TIMESTAMP(3),
  ADD COLUMN "doorHoldPulseAt" TIMESTAMP(3),
  ADD COLUMN "doorHoldError" TEXT;
