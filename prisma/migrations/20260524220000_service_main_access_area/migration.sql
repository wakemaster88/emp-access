-- Service.mainAccessAreaId: Optionale Hauptressource pro Service.
-- Wenn gesetzt, wird sie beim Verkauf als Ticket.accessAreaId verwendet.
-- Bei mehreren ServiceAreas (z. B. Wake&Ski mit Strandbad + Seilbahn A)
-- entscheidet dieses Feld eindeutig, an welcher Ressource die Zeitgueltig-
-- keit (DURATION) startet und die Hauptressourcen-Logik im Pi-Scanner
-- greift. NULL = kein Default; Frontend faellt auf erste serviceArea
-- (sortiert nach id) zurueck.
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "mainAccessAreaId" INTEGER;

-- FK auf AccessArea: SetNull, wenn die Area geloescht wird, damit der
-- Service nicht versehentlich mit kaskadiert wird.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Service_mainAccessAreaId_fkey'
  ) THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT "Service_mainAccessAreaId_fkey"
      FOREIGN KEY ("mainAccessAreaId") REFERENCES "AccessArea"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Service_mainAccessAreaId_idx" ON "Service"("mainAccessAreaId");

-- Daten-Migration: Bei Multi-Area-Services mit klarer Wertigkeit setzen wir
-- die Hauptressource so, wie sie geschaeftlich gemeint ist. Konkret bei
-- "Oeffentlicher Betrieb"-Services (Wake&Ski-Modell): Seilbahn A ist die
-- Hauptressource, das Strandbad ist Transit/Tagesticket.
--
-- Wir matchen nur Services, die sowohl Seilbahn A (id wird ueber Name
-- aufgeloest) als auch Strandbad in ihren ServiceAreas haben - das stellt
-- sicher, dass wir keine Single-Area-Services unbeabsichtigt umkonfigurieren.
UPDATE "Service" s
SET "mainAccessAreaId" = sa_main."accessAreaId"
FROM "ServiceArea" sa_main
JOIN "AccessArea" a_main
  ON a_main.id = sa_main."accessAreaId" AND a_main.name = 'Seilbahn A'
WHERE sa_main."serviceId" = s.id
  AND s.name LIKE 'Öffentlicher Betrieb%'
  AND s."mainAccessAreaId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "ServiceArea" sa_sec
    JOIN "AccessArea" a_sec ON a_sec.id = sa_sec."accessAreaId" AND a_sec.name = 'Strandbad'
    WHERE sa_sec."serviceId" = s.id
  );

-- Bestandstickets korrigieren: Tickets, die ueber den Shop-Monitor mit
-- "areaIds[0]"-Bug auf die falsche Hauptressource (Strandbad) gesetzt
-- wurden, werden auf die jetzt definierte Service-Hauptressource (Seilbahn
-- A) umgezogen. Dadurch werden Reentry-/DURATION-Checks im Pi-Scanner
-- semantisch korrekt: Strandbad-Scans gelten als Transit, Zeitablauf
-- blockt nur die Hauptressource.
--
-- Schutz: Nur Tickets, deren aktuelle accessAreaId in den serviceAreas des
-- Services liegt (sicher) und der Service eine mainAccessAreaId definiert
-- hat. Tickets ohne Service oder mit explizit anderer Konfiguration werden
-- nicht angefasst.
UPDATE "Ticket" t
SET "accessAreaId" = s."mainAccessAreaId"
FROM "Service" s
WHERE t."serviceId" = s.id
  AND s."mainAccessAreaId" IS NOT NULL
  AND t."accessAreaId" IS DISTINCT FROM s."mainAccessAreaId"
  AND EXISTS (
    SELECT 1 FROM "ServiceArea" sa
    WHERE sa."serviceId" = s.id AND sa."accessAreaId" = t."accessAreaId"
  );
