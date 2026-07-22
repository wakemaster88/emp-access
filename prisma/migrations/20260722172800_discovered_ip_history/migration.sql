-- IP-Historie fuer entdeckte Geraete: fruehere IPs mit Zeitstempel.
ALTER TABLE "DiscoveredDevice" ADD COLUMN "ipHistory" JSONB;
