-- Day One: automatisch am ersten Tag des Jahres mit einem Start. Schon
-- eingetragene Aktionstage bleiben und gehen fuer ihr Jahr vor.
UPDATE "Milestone"
SET "metric" = 'OPENING_DAY',
    "hint" = CASE WHEN "hint" = 'Start am Opening-Tag der Saison.' THEN 'Start am ersten Tag der Saison.' ELSE "hint" END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'day-one' AND "metric" = 'EVENT_DAYS';

-- Ice Breaker: Start bei unter 10 Grad Wassertemperatur, gemessen vom Fuehler.
UPDATE "Milestone"
SET "metric" = 'COLD_DAYS',
    "tempBelow" = 10,
    "eventDays" = ARRAY[]::DATE[],
    "hint" = CASE WHEN "hint" = 'Start an einem Tag mit unter 15 °C Wassertemperatur.' THEN 'Start an einem Tag mit unter 10 °C Wassertemperatur.' ELSE "hint" END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'ice-breaker' AND "metric" = 'EVENT_DAYS';

-- Wasser-Fuehler vorbelegen: der eine Sensor des Kontos, der "Wasser" oder
-- "Wassertemperatur ..." heisst. Bei keinem oder mehreren bleibt das Feld leer
-- und wird in den Einstellungen gewaehlt.
UPDATE "GamificationConfig" c
SET "waterSensorDeviceId" = d.id, "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT "accountId", min("id") AS id
  FROM "Device"
  WHERE "category" = 'SENSOR'
    AND (lower(trim("name")) = 'wasser' OR lower(trim("name")) LIKE 'wassertemp%')
  GROUP BY "accountId"
  HAVING count(*) = 1
) d
WHERE d."accountId" = c."accountId" AND c."waterSensorDeviceId" IS NULL;
