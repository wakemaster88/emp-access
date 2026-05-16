-- AlterTable: Email-Regeln um lookbackDays erweitern (zusätzliches Rückwärts-Fenster).
-- Default 7 Tage, damit verpasste Cron-Tage (Outage, frisch aktivierte Regeln)
-- rückwirkend nachgeholt werden. Cooldown verhindert weiterhin Doppel-Sends.
ALTER TABLE "EmailRule" ADD COLUMN IF NOT EXISTS "lookbackDays" INTEGER NOT NULL DEFAULT 7;
