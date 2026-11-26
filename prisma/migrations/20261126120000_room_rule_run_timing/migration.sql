-- Messpunkte im Regel-Verlauf: Zeit des ausloesenden Ereignisses und Beginn
-- der Ausfuehrung. Beide leer erlaubt, aeltere Laeufe bleiben ohne Wert.
ALTER TABLE "RoomRuleRun" ADD COLUMN IF NOT EXISTS "eventAt" TIMESTAMP(3);
ALTER TABLE "RoomRuleRun" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
