-- Antriebe mit zwei Fahrtrichtungen (Markise, Rolltor/Rollladen).

-- Neue Geraetekategorien
ALTER TYPE "DeviceCategory" ADD VALUE IF NOT EXISTS 'MARKISE';
ALTER TYPE "DeviceCategory" ADD VALUE IF NOT EXISTS 'ROLLTOR';

-- Neue Szenen-/Automationsaktionen
ALTER TYPE "ShellyAction" ADD VALUE IF NOT EXISTS 'OPEN';
ALTER TYPE "ShellyAction" ADD VALUE IF NOT EXISTS 'CLOSE';
ALTER TYPE "ShellyAction" ADD VALUE IF NOT EXISTS 'STOP';

-- Kanalzuordnung und Fahrzeit je Antrieb
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "coverUpChannel" INTEGER;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "coverDownChannel" INTEGER;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "coverRuntimeSec" INTEGER;
