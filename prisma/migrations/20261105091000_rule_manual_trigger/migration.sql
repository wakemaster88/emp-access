-- Szenen: Regel ohne Ausloeser, laeuft nur von Hand (Kachel in der Raumkarte).
ALTER TYPE "RuleTrigger" ADD VALUE IF NOT EXISTS 'MANUAL';
