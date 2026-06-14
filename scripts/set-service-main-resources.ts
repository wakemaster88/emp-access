/**
 * Einmal-Skript: Setzt die fehlende Hauptressource (Service.mainAccessAreaId)
 * fuer kombinierte Services (Aktivitaet + Strandbad). Ohne Hauptressource
 * startet der DURATION-Timer schon am Strandbad-Drehkreuz, weil die Scan-
 * Logik nicht weiss, welche Area die "Hauptressource" ist.
 *
 * Sicherheitsmechanik:
 *   - Match per Service-NAME (kein hartkodiertes ID-Raten ueber Accounts).
 *   - Ziel-Area wird per NAME aufgeloest und MUSS Teil der serviceAreas sein
 *     (gleiche Regel wie die /api/services API). Sonst wird der Service
 *     uebersprungen.
 *   - Idempotent: bereits korrekt gesetzte mainAccessAreaId bleibt unangetastet.
 *
 * Aufruf:
 *   npx tsx scripts/set-service-main-resources.ts            # Vorschau (dry-run)
 *   APPLY=1 npx tsx scripts/set-service-main-resources.ts     # tatsaechlich schreiben
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

/** Service-Name -> Name der gewuenschten Hauptressource (Area). */
const MAPPING: Record<string, string> = {
  "Aquapark Stundenkarte": "Aquapark",
  "Aquapark Tageskarte": "Aquapark",
  "Exklusive Bahnmiete A": "Seilbahn A",
  "Exklusive Bahnmiete B": "Seilbahn B",
  "Exklusiver Übungslift": "Übungslift",
};

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(apply ? "MODUS: APPLY (schreibt)" : "MODUS: DRY-RUN (zeigt nur, schreibt nichts)\n");

  const services = await prisma.service.findMany({
    where: { name: { in: Object.keys(MAPPING) } },
    select: {
      id: true,
      name: true,
      accountId: true,
      mainAccessAreaId: true,
      serviceAreas: { select: { accessAreaId: true, area: { select: { name: true } } } },
    },
  });

  if (services.length === 0) {
    console.error("Keine passenden Services gefunden – Namen pruefen.");
    process.exitCode = 1;
    return;
  }

  let changed = 0;
  let skipped = 0;
  for (const svc of services) {
    const targetAreaName = MAPPING[svc.name];
    const match = svc.serviceAreas.find((sa) => sa.area?.name === targetAreaName);

    if (!match) {
      console.warn(
        `  SKIP #${svc.id} "${svc.name}" (acc=${svc.accountId}): Ziel-Area "${targetAreaName}" ` +
          `ist KEINE serviceArea [${svc.serviceAreas.map((sa) => sa.area?.name).join(", ")}].`,
      );
      skipped++;
      continue;
    }

    if (svc.mainAccessAreaId === match.accessAreaId) {
      console.log(`  OK   #${svc.id} "${svc.name}": main bereits ${targetAreaName} (${match.accessAreaId}).`);
      skipped++;
      continue;
    }

    console.log(
      `  SET  #${svc.id} "${svc.name}" (acc=${svc.accountId}): main ${svc.mainAccessAreaId ?? "—"} -> ` +
        `${match.accessAreaId} (${targetAreaName})`,
    );
    if (apply) {
      await prisma.service.update({
        where: { id: svc.id },
        data: { mainAccessAreaId: match.accessAreaId },
      });
    }
    changed++;
  }

  console.log(
    `\n${apply ? "Geschrieben" : "Wuerde aendern"}: ${changed}, unveraendert/uebersprungen: ${skipped}.` +
      (apply ? "" : "\nZum Anwenden erneut mit  APPLY=1  ausfuehren."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
