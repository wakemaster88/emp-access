-- Kamera: MAC-Adresse fuer IP-Re-Mapping bei DHCP-Wechsel (vom Hub gelernt).
ALTER TABLE "Camera" ADD COLUMN "macAddress" TEXT;
