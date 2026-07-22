-- Kamera-Typ: REOLINK (Standard) oder DOORBIRD (Klingel + Türöffner)
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'REOLINK';
