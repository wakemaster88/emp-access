-- Einstellung „Wächter“ je Kamera für den Hub. NULL heißt „wie der Raum“
-- (wie bisher), "NIGHT" nur im Nachtfenster, "OFF" nicht bewerten.
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "sentinelMode" TEXT;
