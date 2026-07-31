-- Standard-Quelle einer Beschallungszone: was "Start" ohne weitere Angabe
-- abspielt. Bisher diente dafuer sourceKind, das aber den Ist-Zustand fuehrt
-- und bei einem Stopp auf SILENCE faellt – eine im Dialog gewaehlte Quelle war
-- damit nach dem ersten Stopp wieder vergessen.

ALTER TABLE "AudioZone"
  ADD COLUMN IF NOT EXISTS "defaultSource" "AudioSourceKind" NOT NULL DEFAULT 'PLAYLIST';

-- Zonen, die bisher nur einen Stream hinterlegt hatten, behalten ihr Verhalten.
UPDATE "AudioZone"
   SET "defaultSource" = 'STREAM'
 WHERE "streamUrl" IS NOT NULL
   AND "playlistId" IS NULL;
