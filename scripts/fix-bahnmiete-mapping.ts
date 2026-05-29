/**
 * Korrigiert die Fehlzuordnung "Exklusive Bahnmiete B" auf Seilbahn A.
 *
 * Ursache: Service A (13) und Service B (7) teilten sich die generischen
 * ANNY-Namen "Exklusive Bahnmiete - Wochenende" / "- Wochentag". Beim Sync
 * gewann B die Namenskollision, obwohl die physische Ressource (Seilbahn A,
 * accessAreaId=5) korrekt war.
 *
 * Fix:
 *  1) Daten: alle Tickets serviceId=7 (B) + accessAreaId=5 (Seilbahn A) -> serviceId=13 (A)
 *  2) Konfig: generische annyNames aus Service B (7) entfernen, damit kuenftige
 *     Syncs nicht erneut falsch zuordnen.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const SERVICE_A = 13;
const SERVICE_B = 7;
const SEILBAHN_A = 5;
const GENERIC_NAMES = ["Exklusive Bahnmiete - Wochenende", "Exklusive Bahnmiete - Wochentag"];

async function main() {
  const dryRun = process.env.APPLY !== "1";
  console.log(dryRun ? ">> DRY RUN (zum Anwenden: APPLY=1)\n" : ">> APPLY MODE\n");

  // 1) Datenkorrektur
  const toFix = await prisma.ticket.findMany({
    where: { serviceId: SERVICE_B, accessAreaId: SEILBAHN_A },
    select: { id: true, name: true, ticketTypeName: true, status: true },
  });
  console.log(`Tickets Service B (7) auf Seilbahn A (5): ${toFix.length}`);
  for (const t of toFix) {
    console.log(`  #${t.id} ${t.name} [${t.status}] "${t.ticketTypeName}"`);
  }

  if (!dryRun && toFix.length > 0) {
    const res = await prisma.ticket.updateMany({
      where: { serviceId: SERVICE_B, accessAreaId: SEILBAHN_A },
      data: { serviceId: SERVICE_A, version: { increment: 1 } },
    });
    console.log(`-> ${res.count} Tickets auf Service A (13) umgestellt.\n`);
  }

  // 2) Konfig: generische Namen aus Service B entfernen
  const svcB = await prisma.service.findUnique({
    where: { id: SERVICE_B },
    select: { annyNames: true },
  });
  const current: string[] = svcB?.annyNames ? JSON.parse(svcB.annyNames) : [];
  const cleaned = current.filter((n) => !GENERIC_NAMES.includes(n));
  console.log(`Service B annyNames vorher: ${JSON.stringify(current)}`);
  console.log(`Service B annyNames nachher: ${JSON.stringify(cleaned)}`);

  if (!dryRun && cleaned.length !== current.length) {
    await prisma.service.update({
      where: { id: SERVICE_B },
      data: { annyNames: JSON.stringify(cleaned) },
    });
    console.log("-> Service B annyNames bereinigt.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
