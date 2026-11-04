-- Regel-Aktion „Kamera steuern“: Preset anfahren, automatisch folgen an/aus.
ALTER TYPE "RuleActionKind" ADD VALUE IF NOT EXISTS 'CAMERA';

ALTER TABLE "RoomRuleAction"
  ADD COLUMN IF NOT EXISTS "targetCameraId" INTEGER,
  ADD COLUMN IF NOT EXISTS "ptzPresetId" INTEGER,
  ADD COLUMN IF NOT EXISTS "autoTrack" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "returnAfterSeconds" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoomRuleAction_targetCameraId_fkey') THEN
    ALTER TABLE "RoomRuleAction"
      ADD CONSTRAINT "RoomRuleAction_targetCameraId_fkey" FOREIGN KEY ("targetCameraId")
      REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RoomRuleAction_targetCameraId_idx" ON "RoomRuleAction"("targetCameraId");
