-- Vereinsportal: Services, die bei Tageslicht buchbar sind (eigene Slots von
-- Sonnenaufgang bis Sonnenuntergang statt der anny-Zeiten), und je Buchung,
-- für wen gebucht wurde.
ALTER TABLE "VereinBookableService" ADD COLUMN IF NOT EXISTS "daylight" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VereinSlotBooking" ADD COLUMN IF NOT EXISTS "bookedFor" TEXT;
