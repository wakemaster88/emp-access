/**
 * Setzt die EMP-eigene Slot-Kapazitaet der Anfaengerkurse.
 *
 * In ANNY haengen "Anfaengerkurs - 1 Stunde Uebungslift" und "Anfaengerkurs -
 * 1 Stunde Seilbahn B" an derselben Resource "Wake & Ski - Anfaengerkurse".
 * ANNY zaehlt Buchungen pro Resource, deshalb senkt jede Buchung die freien
 * Plaetze bei BEIDEN Kursen. Mit `Service.slotCapacity` rechnet EMP die
 * Belegung selbst - nur aus den Buchungen des jeweiligen Service.
 *
 * Aufruf: npx tsx --env-file=.env.local scripts/set-anfaengerkurs-slot-capacity.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

/** Service-Name -> Plaetze pro Slot. */
const CAPACITIES: Record<string, number> = {
  "Anfängerkurs - Übungslift": 10,
  "Anfängerkurs - Seilbahn B": 15,
};

async function main() {
  for (const [name, capacity] of Object.entries(CAPACITIES)) {
    const svc = await prisma.service.findFirst({
      where: { name },
      select: { id: true, name: true, slotCapacity: true },
    });
    if (!svc) {
      console.log(`  UEBERSPRUNGEN: Service "${name}" nicht gefunden`);
      continue;
    }
    if (svc.slotCapacity === capacity) {
      console.log(`  unveraendert: #${svc.id} "${svc.name}" slotCapacity=${capacity}`);
      continue;
    }
    await prisma.service.update({
      where: { id: svc.id },
      data: { slotCapacity: capacity },
    });
    console.log(`  gesetzt: #${svc.id} "${svc.name}" slotCapacity ${svc.slotCapacity ?? "NULL"} -> ${capacity}`);
  }

  console.log("\nAktueller Stand aller Services mit eigener Kapazitaet:");
  const all = await prisma.service.findMany({
    where: { slotCapacity: { not: null } },
    select: { id: true, name: true, slotCapacity: true },
    orderBy: { name: "asc" },
  });
  for (const s of all) console.log(`  #${s.id} "${s.name}": ${s.slotCapacity} Plaetze/Slot`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
