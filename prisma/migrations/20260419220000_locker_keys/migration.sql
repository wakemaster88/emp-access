-- Schlosstyp + Schlüssel-Anzahl am Schließfach, Schlüssel-Ausgabe/-Rücknahme
-- pro Vermietung. Bestehende Daten bleiben mit den Default-Werten erhalten.

-- 1) Enum-Typ für die Schloss-Art.
DO $$ BEGIN
  CREATE TYPE "LockerType" AS ENUM ('KEY', 'PADLOCK');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) Locker: Schlosstyp + Soll-Anzahl der Schlüssel/Schlösser.
ALTER TABLE "Locker"
  ADD COLUMN IF NOT EXISTS "lockType" "LockerType" NOT NULL DEFAULT 'KEY';
ALTER TABLE "Locker"
  ADD COLUMN IF NOT EXISTS "keyCount" INTEGER NOT NULL DEFAULT 2;

-- 3) LockerRental: Ausgabe-/Rücknahme-Tracking pro Mietjahr.
ALTER TABLE "LockerRental"
  ADD COLUMN IF NOT EXISTS "keysIssued" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LockerRental"
  ADD COLUMN IF NOT EXISTS "keysReturned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LockerRental"
  ADD COLUMN IF NOT EXISTS "issuedAt" TIMESTAMP(3);
ALTER TABLE "LockerRental"
  ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);
