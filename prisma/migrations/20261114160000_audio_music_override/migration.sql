-- Manuelles Play hat Vorrang vor der Musik-Automatik bis zu diesem Zeitpunkt.
ALTER TABLE "AudioZone" ADD COLUMN IF NOT EXISTS "musicOverrideUntil" TIMESTAMP(3);
