-- MonitorConfig.areaIds: optionale Bereichs-Eingrenzung (AccessArea-IDs) fuer
-- Scan-Monitore. Erlaubt einen Monitor fuer Bereiche OHNE eigenes Scan-Geraet
-- (z.B. Seilbahn B / Uebungslift); die Personenliste wird dann ueber diese
-- Bereiche statt ueber Geraete-Bereiche gefiltert.

ALTER TABLE "MonitorConfig"
  ADD COLUMN IF NOT EXISTS "areaIds" JSONB NOT NULL DEFAULT '[]';
