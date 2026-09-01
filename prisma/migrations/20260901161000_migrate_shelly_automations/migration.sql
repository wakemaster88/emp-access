-- Bestandsautomationen in Raumregeln ueberfuehren.
--
-- Zuordnungen:
--   Ausloeser: SCHEDULE -> TIME, SUNRISE/SUNSET bleiben, CAMERA_EVENT -> MOTION
--   Aktion:    ON/TOGGLE -> 'open', OFF -> 'reset', OPEN -> 'open',
--              CLOSE -> 'close', STOP -> 'stop'
--   Raum:      bei Kamera-Ausloeser der Raum der Kamera, sonst der Raum des
--              ersten Zielgeraets. Ohne Raum bleibt die Regel betriebsweit.
--
-- `lastRunAt` wird uebernommen, damit eine gerade gelaufene Automation nicht
-- unmittelbar nach der Migration erneut feuert.
--
-- Die alten Tabellen bleiben in dieser Migration stehen und werden erst in der
-- folgenden entfernt, damit der Zwischenstand pruefbar ist.

INSERT INTO "RoomRule" (
  "accountId", "roomId", "name", "description", "isActive", "sortOrder",
  "trigger", "daysOfWeek", "timeOfDay", "offsetMinutes",
  "cameraId", "eventType", "operating", "windowStart", "windowEnd",
  "onlyWhenDark", "cooldownSeconds", "lastRunAt", "createdAt", "updatedAt"
)
SELECT
  a."accountId",
  COALESCE(
    cam."keyRoomId",
    (
      SELECT d."keyRoomId"
      FROM "ShellyGroupMember" m
      JOIN "Device" d ON d."id" = m."deviceId"
      WHERE m."groupId" = a."groupId" AND d."keyRoomId" IS NOT NULL
      ORDER BY m."sortOrder", m."id"
      LIMIT 1
    )
  ) AS "roomId",
  a."name",
  'Übernommen aus der früheren Shelly-Automation "' || g."name" || '".' AS "description",
  a."isActive",
  0,
  CASE a."trigger"::text
    WHEN 'SCHEDULE' THEN 'TIME'
    WHEN 'SUNRISE' THEN 'SUNRISE'
    WHEN 'SUNSET' THEN 'SUNSET'
    WHEN 'CAMERA_EVENT' THEN 'MOTION'
  END::"RuleTrigger" AS "trigger",
  a."daysOfWeek",
  a."timeOfDay",
  a."offsetMinutes",
  a."cameraId",
  a."eventType",
  'ANY'::"RuleOperatingCondition",
  a."windowStart",
  a."windowEnd",
  false,
  -- Kamera-Automationen hatten Minuten als Sperrzeit; zeitgesteuerte hatten
  -- eine feste Fuenf-Minuten-Sperre im Code.
  CASE
    WHEN a."trigger"::text = 'CAMERA_EVENT' THEN GREATEST(a."cooldownMinutes", 1) * 60
    ELSE 300
  END AS "cooldownSeconds",
  a."lastRunAt",
  a."createdAt",
  a."updatedAt"
FROM "ShellyAutomation" a
JOIN "ShellyGroup" g ON g."id" = a."groupId"
LEFT JOIN "Camera" cam ON cam."id" = a."cameraId"
-- Schutz gegen doppelte Ausfuehrung der Migration.
WHERE NOT EXISTS (
  SELECT 1 FROM "RoomRule" r
  WHERE r."accountId" = a."accountId" AND r."name" = a."name"
);

-- Je Szenen-Mitglied eine Geraete-Aktion an der neuen Regel.
INSERT INTO "RoomRuleAction" (
  "ruleId", "sortOrder", "kind", "deviceId", "deviceAction", "timerSeconds"
)
SELECT
  r."id",
  m."sortOrder",
  'DEVICE'::"RuleActionKind",
  m."deviceId",
  CASE m."action"::text
    WHEN 'ON' THEN 'open'
    WHEN 'TOGGLE' THEN 'open'
    WHEN 'OFF' THEN 'reset'
    WHEN 'OPEN' THEN 'open'
    WHEN 'CLOSE' THEN 'close'
    WHEN 'STOP' THEN 'stop'
  END AS "deviceAction",
  m."timerSeconds"
FROM "ShellyAutomation" a
JOIN "ShellyGroupMember" m ON m."groupId" = a."groupId"
JOIN "RoomRule" r ON r."accountId" = a."accountId" AND r."name" = a."name"
WHERE NOT EXISTS (
  SELECT 1 FROM "RoomRuleAction" ra
  WHERE ra."ruleId" = r."id" AND ra."deviceId" = m."deviceId"
);

-- Verlauf mitnehmen, damit die bisherigen Laeufe nicht verschwinden.
INSERT INTO "RoomRuleRun" (
  "accountId", "ruleId", "ruleName", "roomId", "triggeredAt", "triggerKind",
  "success", "details", "durationMs", "errorMessage"
)
SELECT
  run."accountId",
  r."id",
  COALESCE(a."name", 'Gelöschte Automation'),
  r."roomId",
  run."triggeredAt",
  run."triggerKind",
  run."success",
  run."details",
  run."durationMs",
  run."errorMessage"
FROM "ShellyAutomationRun" run
LEFT JOIN "ShellyAutomation" a ON a."id" = run."automationId"
LEFT JOIN "RoomRule" r ON r."accountId" = run."accountId" AND r."name" = a."name"
WHERE NOT EXISTS (
  SELECT 1 FROM "RoomRuleRun" rr
  WHERE rr."accountId" = run."accountId"
    AND rr."triggeredAt" = run."triggeredAt"
    AND rr."triggerKind" = run."triggerKind"
);
