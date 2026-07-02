-- Zonen-Stammdaten fuer die Wasserbilanz-Bewaesserung:
--  * flowLpm → Durchflussrate der Zone (Liter/Minute)
--  * areaSqm → bewaesserte Flaeche (m²)
-- Dauer je Ventil = Wasserdefizit (mm) × Flaeche ÷ Durchsatz.
-- IF NOT EXISTS-Guards, damit wiederholtes `migrate deploy` harmlos bleibt.

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "flowLpm" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "areaSqm" DOUBLE PRECISION;
