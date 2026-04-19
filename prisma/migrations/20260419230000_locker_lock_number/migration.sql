-- Aufgedruckte Schloss-/Zylindernummer am Schließfach
-- (relevant nur bei lockType = KEY).
ALTER TABLE "Locker"
  ADD COLUMN IF NOT EXISTS "lockNumber" TEXT;
