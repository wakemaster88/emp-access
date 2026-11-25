-- Zähler der Einladungslinks einer Familie: ein neuer Link erhöht ihn, ältere
-- gelten dann nicht mehr. Additiv, Standard 0 entspricht dem bisherigen Stand.
ALTER TABLE "RiderFamily" ADD COLUMN IF NOT EXISTS "inviteVersion" INTEGER NOT NULL DEFAULT 0;

-- Letzte Änderung des Geburtsdatums durch die Person in der App. Additiv,
-- NULL heißt: noch nie in der App geändert.
ALTER TABLE "RiderProfile" ADD COLUMN IF NOT EXISTS "birthDateChangedAt" TIMESTAMP(3);

-- Beitritte zur Familie, deren Meldung an die Erwachsenen wegen der Nachtruhe
-- noch aussteht (Profil-IDs). Additiv, leer heißt: nichts offen.
ALTER TABLE "RiderFamily" ADD COLUMN IF NOT EXISTS "joinNoticeIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
