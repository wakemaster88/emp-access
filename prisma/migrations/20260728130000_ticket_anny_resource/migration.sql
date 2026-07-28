-- ANNY-Ressource pro Ticket. Kombi-Services ("Aquapark Tageskarte" =
-- Aquapark + Strandbad) erzeugen in ANNY eine Buchung je Ressource, also
-- mehrere Tickets pro Gast. `accessAreaId` wird beim Sync auf die
-- Hauptressource des Service ueberschrieben und kann die Buchungen deshalb
-- nicht auseinanderhalten - dieses Feld kann es.
ALTER TABLE "Ticket"
  ADD COLUMN "annyResourceId" TEXT;
