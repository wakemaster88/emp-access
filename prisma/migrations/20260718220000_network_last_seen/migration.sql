-- Online-Status fuer Netzwerk-Hardware und -Clients: lastSeenAt wird vom
-- Hub-Netzwerk-Scan per MAC-Abgleich aktualisiert.

ALTER TABLE "NetworkDevice" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "NetworkClient" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
