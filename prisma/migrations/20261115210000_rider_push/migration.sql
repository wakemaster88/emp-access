-- Gamification Etappe 6: Push-Benachrichtigungen der Kunden-App.
CREATE TABLE "RiderPushSubscription" (
    "id" SERIAL NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "profileId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiderPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiderPushSubscription_endpoint_key" ON "RiderPushSubscription"("endpoint");
CREATE INDEX "RiderPushSubscription_profileId_idx" ON "RiderPushSubscription"("profileId");
CREATE INDEX "RiderPushSubscription_accountId_idx" ON "RiderPushSubscription"("accountId");
ALTER TABLE "RiderPushSubscription" ADD CONSTRAINT "RiderPushSubscription_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderPushSubscription" ADD CONSTRAINT "RiderPushSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
