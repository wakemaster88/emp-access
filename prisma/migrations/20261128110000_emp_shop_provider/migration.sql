-- EMP-Shop als Integration: der Shop-Monitor schlaegt gescannte Preisetiketten
-- ueber die Public API des EMP-Shops nach (Shop-Scan, 28.11.2026).
--
-- IF NOT EXISTS, damit ein zweites `migrate deploy` harmlos bleibt.

ALTER TYPE "ApiProvider" ADD VALUE IF NOT EXISTS 'EMP_SHOP';
