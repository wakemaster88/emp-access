-- Profilbild der Kunden-App: waehlt die Person selbst. Das Foto zum Abgleich
-- an der Kasse (Ticket.profileImage) bleibt davon unberuehrt.
ALTER TABLE "RiderProfile" ADD COLUMN "photo" TEXT;
