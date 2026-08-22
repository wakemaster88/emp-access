-- Optionale Scan-Sperrzeit pro Geraet (Sekunden nach einem gueltigen Scan).
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "scanLockSeconds" INTEGER;
