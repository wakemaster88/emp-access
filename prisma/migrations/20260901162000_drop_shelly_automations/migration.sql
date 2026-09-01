-- Die alten Automations-Tabellen entfernen. Die Inhalte sind in der vorigen
-- Migration nach `RoomRule`/`RoomRuleAction`/`RoomRuleRun` uebernommen worden.
--
-- `ShellyAction` bleibt: die Kennzeichen- und Personenlisten
-- (`AllowedVehicle.shellyAction`, `ListedPerson.shellyAction`) verwenden das
-- Enum weiterhin.

DROP TABLE IF EXISTS "ShellyAutomationRun";
DROP TABLE IF EXISTS "ShellyAutomation";
DROP TABLE IF EXISTS "ShellyGroupMember";
DROP TABLE IF EXISTS "ShellyGroup";

DROP TYPE IF EXISTS "AutomationTrigger";
