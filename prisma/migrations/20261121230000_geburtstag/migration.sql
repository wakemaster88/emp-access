-- Geburtstag in der Kunden-App: Gruß, Geschenk, Push und Durchsage am Drehkreuz.
ALTER TABLE "RiderProfile" ADD COLUMN "birthdayAnnounce" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "RiderBirthday" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "text" TEXT,
    "voucherLabel" TEXT,
    "voucherValidDays" INTEGER,
    "pushPlanned" BOOLEAN NOT NULL DEFAULT false,
    "announceActive" BOOLEAN NOT NULL DEFAULT false,
    "announceText" TEXT,
    "announceName" BOOLEAN NOT NULL DEFAULT true,
    "announceZoneIds" JSONB NOT NULL DEFAULT '[]',
    "announceVoice" TEXT,
    "announceChime" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiderBirthday_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiderBirthday_accountId_key" ON "RiderBirthday"("accountId");
ALTER TABLE "RiderBirthday" ADD CONSTRAINT "RiderBirthday_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RiderBirthdayGift" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL,
    "giftAt" TIMESTAMP(3),
    "voucherId" INTEGER,
    "pushedAt" TIMESTAMP(3),
    "pushSent" INTEGER,
    "announcedAt" TIMESTAMP(3),
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiderBirthdayGift_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiderBirthdayGift_profileId_year_key" ON "RiderBirthdayGift"("profileId", "year");
CREATE INDEX "RiderBirthdayGift_accountId_idx" ON "RiderBirthdayGift"("accountId");
CREATE INDEX "RiderBirthdayGift_voucherId_idx" ON "RiderBirthdayGift"("voucherId");
ALTER TABLE "RiderBirthdayGift" ADD CONSTRAINT "RiderBirthdayGift_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderBirthdayGift" ADD CONSTRAINT "RiderBirthdayGift_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiderBirthdayGift" ADD CONSTRAINT "RiderBirthdayGift_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
