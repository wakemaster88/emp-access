-- Beach Pass: dieselbe Kunden-App für Strandbad-Kunden, ab Werk aus.
CREATE TYPE "PassAudience" AS ENUM ('RIDE', 'BEACH', 'ALL');

ALTER TABLE "GamificationConfig" ADD COLUMN "beachEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GamificationConfig" ADD COLUMN "beachSubscriptionIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Bisherige Awards, Challenges und Angebote bleiben beim Ride Pass.
ALTER TABLE "Milestone" ADD COLUMN "audience" "PassAudience" NOT NULL DEFAULT 'RIDE';
ALTER TABLE "Challenge" ADD COLUMN "audience" "PassAudience" NOT NULL DEFAULT 'RIDE';
ALTER TABLE "RiderOffer" ADD COLUMN "audience" "PassAudience" NOT NULL DEFAULT 'RIDE';
