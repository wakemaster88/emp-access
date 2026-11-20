-- Vorlage der 20 Awards (Liste AWARD_DEFAULTS in src/lib/awards.ts) fuer jeden
-- Mandanten, bei dem die Kunden-App eingeschaltet ist. Namen, Ziele und
-- Gutscheine hat Aaron am 20.11.2026 freigegeben; danach ist alles in der
-- Verwaltung aenderbar. Ein schon vorhandener Schluessel bleibt unberuehrt.

INSERT INTO "Milestone" (
  "accountId", "key", "name", "tier", "metric", "threshold", "period",
  "voucherLabel", "voucherShort", "voucherValidDays", "bonus", "hint",
  "active", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  c."accountId", v."key", v."name", v."tier"::"GamiTier", v."metric"::"GamiMetric", v."threshold", v."period"::"GamiPeriod",
  v."voucherLabel", v."voucherShort", v."voucherValidDays", v."bonus", v."hint",
  true, v."sortOrder", now(), now()
FROM "GamificationConfig" c
CROSS JOIN (VALUES
  ('first-splash', 'First Splash', 'BRONZE', 'STARTS', 1, 'ALL_TIME', 'Welcome Drink: ein Softdrink nach Wahl', 'Welcome Drink', 365, NULL, 'Dein allererster Start am Lift.', 101),
  ('hooked', 'Hooked', 'BRONZE', 'STARTS', 25, 'ALL_TIME', 'Ein Eis nach Wahl', 'Eis nach Wahl', 365, NULL, NULL, 102),
  ('cable-rat', 'Cable Rat', 'SILVER', 'STARTS', 100, 'ALL_TIME', 'Eine Portion Steakhaus Pommes', 'Pommes', 365, NULL, NULL, 103),
  ('lap-machine', 'Lap Machine', 'SILVER', 'STARTS', 250, 'ALL_TIME', 'Combo nach Wahl: Currywurst, Chicken oder Kibbelinge mit Pommes', 'Pommes-Combo', 365, NULL, NULL, 104),
  ('dock-boss', 'Dock Boss', 'GOLD', 'STARTS', 500, 'ALL_TIME', 'Bring a Friend: Tageskarte Wake & Ski für eine Begleitung', 'Bring a Friend', 365, NULL, NULL, 105),
  ('thousand-club', 'Thousand Club', 'GOLD', 'STARTS', 1000, 'ALL_TIME', 'Sunset Session für dich und eine Begleitung', 'Sunset Session', 365, NULL, NULL, 106),
  ('tuttenbrock-legend', 'Tuttenbrock Legend', 'LEGENDARY', 'STARTS', 2500, 'ALL_TIME', 'Private Session: 1 Stunde Übungslift exklusiv für dich und deine Crew', 'Private Session', NULL, NULL, '2.500 Starts am Lift. Das Fernziel für die ganz Harten.', 107),
  ('regular', 'Regular', 'BRONZE', 'VISIT_DAYS', 5, 'SEASON', 'Ein Café Crème oder Softdrink', 'Freigetränk', 365, NULL, NULL, 108),
  ('repeat-offender', 'Repeat Offender', 'SILVER', 'VISIT_DAYS', 15, 'SEASON', 'Steakhaus Pommes und ein Softdrink', 'Pommes + Drink', 365, NULL, NULL, 109),
  ('lake-local', 'Lake Local', 'GOLD', 'VISIT_DAYS', 30, 'SEASON', 'Bring a Friend: 1 Stunde Wake & Ski für eine Begleitung', 'Bring a Friend', 365, NULL, NULL, 110),
  ('endless-summer', 'Endless Summer', 'LEGENDARY', 'VISIT_DAYS', 50, 'SEASON', 'Grillplatz für dich und deine Crew', 'Grillplatz für die Crew', 365, 'Hall-of-Fame-Wand', NULL, 111),
  ('butter-hunter', 'Butter Hunter', 'SILVER', 'EARLY_DAYS', 5, 'SEASON', 'Early-Bird-Kaffee: Café Crème oder Cappuccino', 'Kaffee', 365, NULL, '5 Tage mit Start in der ersten Stunde, wenn das Wasser noch spiegelglatt ist.', 112),
  ('weekend-warrior', 'Weekend Warrior', 'SILVER', 'WEEKENDS', 3, 'SEASON', 'Ein alkoholfreies Kaltgetränk nach Wahl', 'Kaltgetränk', 365, NULL, NULL, 113),
  ('day-one', 'Day One', 'GOLD', 'EVENT_DAYS', 1, 'SEASON', 'Opening-Wurst: Bratwurst oder Currywurst', 'Opening-Wurst', 365, NULL, 'Start am Opening-Tag der Saison.', 114),
  ('ice-breaker', 'Ice Breaker', 'GOLD', 'EVENT_DAYS', 1, 'SEASON', 'Eine heiße Schokolade zum Aufwärmen', 'Heiße Schokolade', 365, NULL, 'Start an einem Tag mit unter 15 °C Wassertemperatur.', 115),
  ('round-two', 'Round Two', 'BRONZE', 'SEASONS', 2, 'ALL_TIME', 'Die zweite Runde geht aufs Haus: ein Getränk', 'Freigetränk', 365, NULL, NULL, 116),
  ('og-rider', 'OG Rider', 'SILVER', 'SEASONS', 3, 'ALL_TIME', 'Bring a Friend: Aquapark-Stundenkarte für eine Begleitung', 'Bring a Friend', 365, NULL, NULL, 117),
  ('old-school', 'Old School', 'GOLD', 'SEASONS', 5, 'ALL_TIME', 'Flammkuchen oder Pinsa für zwei', '2× Flammkuchen', 365, NULL, NULL, 118),
  ('lifer', 'Lifer', 'GOLD', 'SEASONS', 7, 'ALL_TIME', 'Ein Abo-Monat geschenkt', 'Gratis-Monat', NULL, NULL, NULL, 119),
  ('hall-of-famer', 'Hall of Famer', 'LEGENDARY', 'SEASONS', 10, 'ALL_TIME', '50 % auf dein nächstes Abo', '50 % aufs Abo', NULL, 'Gravur an der Wand', NULL, 120)
) AS v("key", "name", "tier", "metric", "threshold", "period", "voucherLabel", "voucherShort", "voucherValidDays", "bonus", "hint", "sortOrder")
WHERE c."enabled"
ON CONFLICT ("accountId", "key") DO NOTHING;

-- Die Test-Meilensteine ("TEST: 5 Besuchstage" usw.) haben dieselben Ziele wie
-- die neuen Awards und stuenden sonst doppelt in der Kunden-App. Sie werden
-- nur abgeschaltet, nicht geloescht, und nur, wenn sie nie vergeben wurden.
-- In der Verwaltung lassen sie sich wieder einschalten.
UPDATE "Milestone" m
SET "active" = false, "updatedAt" = now()
WHERE m."name" LIKE 'TEST:%'
  AND m."key" IS NULL
  AND m."active"
  AND m."accountId" IN (SELECT "accountId" FROM "GamificationConfig" WHERE "enabled")
  AND NOT EXISTS (SELECT 1 FROM "MilestoneAward" a WHERE a."milestoneId" = m."id");
