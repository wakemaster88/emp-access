-- Zeit-Regeln mit Nachholfrist (src/lib/rule-due.ts): Soll-Zeit des zuletzt
-- erfolgreich gelaufenen Termins und des zuletzt als verpasst gemeldeten.
-- Rein additiv und nullable: Bestehende Regeln starten leer, der Cron-Lauf
-- liest dann den Verlauf (RoomRuleRun), älterer Code arbeitet unverändert.
ALTER TABLE "RoomRule" ADD COLUMN IF NOT EXISTS "lastOccurrenceAt" TIMESTAMP(3);
ALTER TABLE "RoomRule" ADD COLUMN IF NOT EXISTS "lastMissedAt" TIMESTAMP(3);
