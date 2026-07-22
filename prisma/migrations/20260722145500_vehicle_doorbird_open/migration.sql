-- Fahrzeug-Whitelist: DoorBird-Türöffner bei Kennzeichen-Match
ALTER TABLE "AllowedVehicle" ADD COLUMN IF NOT EXISTS "doorbirdCameraId" INTEGER;
ALTER TABLE "AllowedVehicle"
  ADD CONSTRAINT "AllowedVehicle_doorbirdCameraId_fkey"
  FOREIGN KEY ("doorbirdCameraId") REFERENCES "Camera"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AllowedVehicle_doorbirdCameraId_idx"
  ON "AllowedVehicle"("doorbirdCameraId");
