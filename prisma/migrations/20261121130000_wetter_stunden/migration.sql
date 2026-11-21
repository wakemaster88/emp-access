-- Lufttemperatur am Standort je Stunde (Open-Meteo), fuer "Luft im Schnitt"
-- im Saisonrueckblick der Kunden-App.
CREATE TABLE "WeatherHour" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "temp" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "WeatherHour_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeatherHour_accountId_hour_key" ON "WeatherHour"("accountId", "hour");

ALTER TABLE "WeatherHour" ADD CONSTRAINT "WeatherHour_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
