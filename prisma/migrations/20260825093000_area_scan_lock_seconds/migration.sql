-- Bereichsweite Scan-Sperrzeit: dasselbe Ticket darf einen Bereich nur alle
-- n Sekunden betreten, egal an welchem Eingang und unabhaengig davon, ob
-- zwischendurch am Ausgang gescannt wurde.
ALTER TABLE "AccessArea" ADD COLUMN IF NOT EXISTS "scanLockSeconds" INTEGER;
