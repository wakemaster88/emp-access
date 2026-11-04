-- Face-Embedding pro Sichtung: unbekannte Personen gruppieren und per Klick zuordnen.
ALTER TABLE "PersonSighting" ADD COLUMN IF NOT EXISTS "faceEmbedding" BYTEA;
