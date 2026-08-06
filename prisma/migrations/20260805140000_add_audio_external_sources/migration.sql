-- AirPlay- und Bluetooth-Empfang je Beschallungszone.
--
-- Bewusst keine neuen Werte in "AudioSourceKind": die eingestellte Quelle der
-- Zone bleibt, was sie ist (Playlist, Webradio, Stille). Ein Sender uebernimmt
-- nur voruebergehend – das ist eine eigene Achse und steht in
-- "externalActive"/"externalSender". Andernfalls wuerde eine Uebernahme die im
-- Dialog gewaehlte Quelle ueberschreiben.
--
-- Rein additiv mit Defaults, damit bereits laufende Abspieler nichts merken.

DO $$ BEGIN
  CREATE TYPE "AudioExternalKind" AS ENUM ('AIRPLAY', 'BLUETOOTH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "AudioZone"
  ADD COLUMN IF NOT EXISTS "airplayEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "bluetoothEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "externalName" TEXT,
  ADD COLUMN IF NOT EXISTS "pairableUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "externalActive" "AudioExternalKind",
  ADD COLUMN IF NOT EXISTS "externalSender" TEXT;
