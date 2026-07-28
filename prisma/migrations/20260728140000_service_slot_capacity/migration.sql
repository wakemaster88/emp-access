-- Plaetze pro Slot, die EMP selbst verwaltet. Wenn gesetzt, wird ANNYs
-- `number_available` ignoriert und die Belegung aus den ANNY-Buchungen DIESES
-- Service plus den EMP-Tickets berechnet.
--
-- Notwendig, wenn sich mehrere EMP-Services in ANNY eine Resource teilen: ANNY
-- zaehlt Buchungen pro Resource, nicht pro Service. "Anfaengerkurs Uebungslift"
-- (10 Plaetze) und "Anfaengerkurs Seilbahn B" (15 Plaetze) haengen beide an der
-- Resource "Wake & Ski - Anfaengerkurse" - ohne dieses Feld senkt jede Buchung
-- die freien Plaetze bei BEIDEN Kursen.
ALTER TABLE "Service"
  ADD COLUMN IF NOT EXISTS "slotCapacity" INTEGER;
