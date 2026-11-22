-- Vereinsportal: Inklusivmiete. Je freigegebenem Service kann der Verein
-- statt der Miete eine Inklusivmiete für 0 € wählen (Vorstand, Trainer und
-- Familie 1. Grades, abgedeckt durch die Jahrespauschale). Die Buchung merkt
-- sich, dass sie inklusive war.
ALTER TABLE "VereinBookableService" ADD COLUMN IF NOT EXISTS "inclusive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VereinSlotBooking" ADD COLUMN IF NOT EXISTS "inclusive" BOOLEAN NOT NULL DEFAULT false;
