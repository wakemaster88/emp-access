-- Gamification Etappe 4: öffentliche Rangliste für einen Bildschirm.
ALTER TABLE "GamificationConfig" ADD COLUMN "displayToken" TEXT;
CREATE UNIQUE INDEX "GamificationConfig_displayToken_key" ON "GamificationConfig"("displayToken");
