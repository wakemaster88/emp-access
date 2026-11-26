-- Regel-Version fuer den Plan des Hubs (src/lib/rule-version.ts): Zeitpunkt
-- der letzten Aenderung durch Anlegen oder Bearbeiten, unabhaengig von
-- Laeufen (die setzen `updatedAt`). Rein additiv und nullable: Bestehende
-- Regeln starten leer, die Version nimmt dann `createdAt`.
ALTER TABLE "RoomRule" ADD COLUMN IF NOT EXISTS "configChangedAt" TIMESTAMP(3);
