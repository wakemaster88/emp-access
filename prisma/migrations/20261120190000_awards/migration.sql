-- Awards der Kunden-App: Meilensteine bekommen Seltenheit, Kurztext des
-- Gutscheins, Zugabe, Beschreibung, Aktionstage und einen Vorlagen-Schluessel.
-- Neue Zaehlarten (frueh am Lift, Wochenenden in Folge, Aktionstage, Saisons)
-- und der Zeitraum "Gesamt". Die Vorlage selbst folgt in der naechsten
-- Migration, weil neue Enum-Werte erst nach dem Commit nutzbar sind.

ALTER TYPE "GamiMetric" ADD VALUE 'EARLY_DAYS';
ALTER TYPE "GamiMetric" ADD VALUE 'WEEKENDS';
ALTER TYPE "GamiMetric" ADD VALUE 'EVENT_DAYS';
ALTER TYPE "GamiMetric" ADD VALUE 'SEASONS';

ALTER TYPE "GamiPeriod" ADD VALUE 'ALL_TIME';

CREATE TYPE "GamiTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'LEGENDARY');

ALTER TABLE "Milestone"
  ADD COLUMN "voucherShort" TEXT,
  ADD COLUMN "bonus" TEXT,
  ADD COLUMN "tier" "GamiTier" NOT NULL DEFAULT 'BRONZE',
  ADD COLUMN "hint" TEXT,
  ADD COLUMN "eventDays" DATE[] DEFAULT ARRAY[]::DATE[],
  ADD COLUMN "key" TEXT;

CREATE UNIQUE INDEX "Milestone_accountId_key_key" ON "Milestone"("accountId", "key");

ALTER TABLE "MilestoneAward" ADD COLUMN "seenAt" TIMESTAMP(3);

ALTER TABLE "RiderProfile" ADD COLUMN "ridingSince" INTEGER;

-- Bisher vergebene Meilensteine gelten als gezeigt: der Freischalt-Moment der
-- App ist nur fuer neue Vergaben gedacht.
UPDATE "MilestoneAward" SET "seenAt" = "awardedAt";
