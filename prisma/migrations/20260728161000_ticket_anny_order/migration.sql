-- ANNY-Auftrags-ID: `addOns` gilt je Auftrag, nicht je Ticket. Wird gebraucht,
-- um Verleihmaterial in der Tagesuebersicht nicht mehrfach zu zaehlen.
ALTER TABLE "Ticket" ADD COLUMN "annyOrderId" TEXT;

CREATE INDEX "Ticket_annyOrderId_idx" ON "Ticket"("annyOrderId");
