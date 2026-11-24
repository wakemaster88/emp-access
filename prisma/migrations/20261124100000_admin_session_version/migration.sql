-- Sitzungen der Verwaltung widerrufbar machen: Der Zaehler steigt bei jedem
-- Passwortwechsel, das Sitzungs-JWT traegt den Stand vom Anmelden.
-- Rein additiv mit Standardwert: aelterer Code laeuft unveraendert weiter.
ALTER TABLE "Admin" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
