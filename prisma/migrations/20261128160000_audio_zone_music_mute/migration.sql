-- Musik stumm am Monitor: Musik läuft lautlos weiter, Durchsagen klingen (additiv, ab Werk leer).
ALTER TABLE "AudioZone" ADD COLUMN "musicMutedUntil" TIMESTAMP(3);
