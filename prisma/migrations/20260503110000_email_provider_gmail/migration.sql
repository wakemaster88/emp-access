-- Provider-Default auf GMAIL umstellen.
-- Bestehende Konfigurationen mit Default-Wert "RESEND" werden auf "GMAIL"
-- umgesetzt; explizit gesetzte andere Werte bleiben erhalten (kommen aktuell
-- nicht vor, der Schritt ist trotzdem idempotent).

ALTER TABLE "EmailConfig" ALTER COLUMN "provider" SET DEFAULT 'GMAIL';

UPDATE "EmailConfig" SET "provider" = 'GMAIL' WHERE "provider" = 'RESEND';
