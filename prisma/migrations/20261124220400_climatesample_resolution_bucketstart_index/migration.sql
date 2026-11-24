-- Verdichten der Klimadaten (filtert ohne accountId). Eine Anweisung je
-- Migration, weil CONCURRENTLY nicht in einer Transaktion laufen darf.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ClimateSample_resolution_bucketStart_idx" ON "ClimateSample"("resolution", "bucketStart");
