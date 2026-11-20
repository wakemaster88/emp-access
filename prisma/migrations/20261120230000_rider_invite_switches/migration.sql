-- Einladung zur Kunden-App schaltbar: neue anny-Abos (an) und Bestandskunden (aus).
ALTER TABLE "GamificationConfig" ADD COLUMN "inviteNewAbos" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GamificationConfig" ADD COLUMN "inviteExistingAbos" BOOLEAN NOT NULL DEFAULT false;
