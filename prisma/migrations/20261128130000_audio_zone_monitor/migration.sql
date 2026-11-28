-- Monitor-Seite als Abspieler einer Audio-Zone (Browser statt Pi).
-- Additiv: neue, leere Spalte; alter Code liest sie nicht.
ALTER TABLE "AudioZone" ADD COLUMN "monitorId" INTEGER;

CREATE UNIQUE INDEX "AudioZone_monitorId_key" ON "AudioZone"("monitorId");

ALTER TABLE "AudioZone" ADD CONSTRAINT "AudioZone_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "MonitorConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
