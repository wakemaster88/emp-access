-- Feiertage in der Kunden-App: je Feiertag Gruss, Angebot oder Gutschein.
-- CreateEnum
CREATE TYPE "HolidayShow" AS ENUM ('GREETING', 'OFFER', 'VOUCHER');

-- CreateTable
CREATE TABLE "RiderHoliday" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "show" "HolidayShow" NOT NULL DEFAULT 'GREETING',
    "title" TEXT,
    "text" TEXT,
    "voucherLabel" TEXT,
    "voucherValidDays" INTEGER,
    "daysBefore" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "RiderHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderHolidayGift" (
    "id" SERIAL NOT NULL,
    "holidayId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL,
    "voucherId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "RiderHolidayGift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderHoliday_accountId_idx" ON "RiderHoliday"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderHoliday_accountId_key_key" ON "RiderHoliday"("accountId", "key");

-- CreateIndex
CREATE INDEX "RiderHolidayGift_accountId_idx" ON "RiderHolidayGift"("accountId");

-- CreateIndex
CREATE INDEX "RiderHolidayGift_profileId_idx" ON "RiderHolidayGift"("profileId");

-- CreateIndex
CREATE INDEX "RiderHolidayGift_voucherId_idx" ON "RiderHolidayGift"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderHolidayGift_holidayId_year_profileId_key" ON "RiderHolidayGift"("holidayId", "year", "profileId");

-- AddForeignKey
ALTER TABLE "RiderHoliday" ADD CONSTRAINT "RiderHoliday_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderHolidayGift" ADD CONSTRAINT "RiderHolidayGift_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "RiderHoliday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderHolidayGift" ADD CONSTRAINT "RiderHolidayGift_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderHolidayGift" ADD CONSTRAINT "RiderHolidayGift_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderHolidayGift" ADD CONSTRAINT "RiderHolidayGift_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
