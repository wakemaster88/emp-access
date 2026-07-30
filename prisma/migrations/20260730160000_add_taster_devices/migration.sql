-- Taster: Relais, das auf Knopfdruck fuer eine feste Dauer einschaltet und
-- danach von selbst wieder abfaellt (Aussendusche, Wasserhahn, Torimpuls).

-- Neue Geraetekategorie
ALTER TYPE "DeviceCategory" ADD VALUE IF NOT EXISTS 'TASTER';

-- Impulsdauer je Geraet; NULL = Standardwert der Anwendung
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "pulseSeconds" INTEGER;
