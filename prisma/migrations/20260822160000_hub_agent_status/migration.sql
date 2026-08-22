-- Live-Status des Hubs (Parkplatz-Belegung aus Kiosk-Tracker).
ALTER TABLE "HubAgent" ADD COLUMN IF NOT EXISTS "status" JSONB;
