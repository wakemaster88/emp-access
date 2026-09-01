-- Geraete/Kameras der Schliessanlage zuordnen: Raum als Standort, Schloss als
-- elektronisch bedienter Schliesspunkt (Nuki/LOQED/Shelly).

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "keyRoomId" INTEGER;
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "keyRoomId" INTEGER;
ALTER TABLE "KeyLock" ADD COLUMN IF NOT EXISTS "deviceId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Device_keyRoomId_fkey'
  ) THEN
    ALTER TABLE "Device" ADD CONSTRAINT "Device_keyRoomId_fkey"
      FOREIGN KEY ("keyRoomId") REFERENCES "KeyRoom"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Camera_keyRoomId_fkey'
  ) THEN
    ALTER TABLE "Camera" ADD CONSTRAINT "Camera_keyRoomId_fkey"
      FOREIGN KEY ("keyRoomId") REFERENCES "KeyRoom"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'KeyLock_deviceId_fkey'
  ) THEN
    ALTER TABLE "KeyLock" ADD CONSTRAINT "KeyLock_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Device_keyRoomId_idx" ON "Device"("keyRoomId");
CREATE INDEX IF NOT EXISTS "Camera_keyRoomId_idx" ON "Camera"("keyRoomId");
CREATE INDEX IF NOT EXISTS "KeyLock_deviceId_idx" ON "KeyLock"("deviceId");
