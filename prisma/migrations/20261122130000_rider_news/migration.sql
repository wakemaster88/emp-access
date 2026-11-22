-- News in der Kunden-App: eigene Art neben den Angeboten.
CREATE TYPE "RiderOfferKind" AS ENUM ('OFFER', 'NEWS');
ALTER TABLE "RiderOffer" ADD COLUMN "kind" "RiderOfferKind" NOT NULL DEFAULT 'OFFER';
