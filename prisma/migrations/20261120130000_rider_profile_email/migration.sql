-- Kunden-App: Anmeldung per E-Mail, Profil auch ohne Ticket.
ALTER TABLE "RiderProfile" ADD COLUMN "email" TEXT;
CREATE INDEX "RiderProfile_accountId_email_idx" ON "RiderProfile"("accountId", "email");
