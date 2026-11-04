-- Lieferdienste an der Aufschrift erkennen und das Tor oeffnen.
ALTER TABLE "Camera"
  ADD COLUMN IF NOT EXISTS "deliveryMode" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryFrom" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryTo" TEXT;

ALTER TABLE "VehicleSighting"
  ADD COLUMN IF NOT EXISTS "deliveryBrand" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryOpened" BOOLEAN NOT NULL DEFAULT false;
