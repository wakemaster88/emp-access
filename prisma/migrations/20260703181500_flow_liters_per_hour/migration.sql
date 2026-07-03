-- Durchflussrate der Zone von Liter/Minute auf Liter/Stunde umstellen, weil
-- die GARDENA-Pumpe den Durchfluss in L/h anzeigt und der Wert so direkt
-- uebernommen werden kann. Bestehende Werte werden mit × 60 konvertiert.
-- Guards, damit wiederholtes `migrate deploy` harmlos bleibt.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Device' AND column_name = 'flowLpm'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Device' AND column_name = 'flowLph'
  ) THEN
    ALTER TABLE "Device" RENAME COLUMN "flowLpm" TO "flowLph";
    UPDATE "Device" SET "flowLph" = "flowLph" * 60 WHERE "flowLph" IS NOT NULL;
  END IF;
END $$;

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "flowLph" DOUBLE PRECISION;
