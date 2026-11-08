-- Vereinsportal: Wunschzeit-Anfragen, die das Backoffice freigibt oder ablehnt.
ALTER TYPE "VereinBookingStatus" ADD VALUE IF NOT EXISTS 'REQUESTED';
ALTER TYPE "VereinBookingStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TABLE "VereinSlotBooking" ADD COLUMN IF NOT EXISTS "rejectReason" TEXT;
ALTER TABLE "VereinSlotBooking" ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3);
