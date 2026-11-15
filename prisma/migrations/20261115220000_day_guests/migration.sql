-- Gamification Etappe 7: Tagesgäste in der Kunden-App und Abo-Rechner.
ALTER TABLE "GamificationConfig" ADD COLUMN "dayServiceIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "GamificationConfig" ADD COLUMN "servicePrices" JSONB;
ALTER TABLE "GamificationConfig" ADD COLUMN "subscriptionPrices" JSONB;
