/**
 * One-off: Macht die Mitglieds-Tickets des Vereins "Tristar Oelde" im
 * Shop-Monitor (CHECKIN) sichtbar, damit dort pro Mitglied ein RFID-Band
 * zugeordnet werden kann. Dafuer bekommt jedes Mitglied:
 *   - startDate = 2026-01-01
 *   - endDate   = 2026-12-31
 *   - ticketTypeName = "Tristar Oelde Mitglied"   (nur falls leer)
 *
 * Zutritt wird weiterhin ausschliesslich ueber das Vereins-Zutritts-Ticket
 * "Strandbad Jahresticket 2026" geregelt (subscriptionId/serviceId/area
 * bleiben unveraendert).
 *
 * Idempotent: erneutes Ausfuehren ueberschreibt nichts versehentlich.
 *
 * Run:  npx tsx scripts/import-tristar-make-visible.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import "dotenv/config";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ACCOUNT_ID = 1; // Tuttenbrocksee
const VEREIN_NAME = "Tristar Oelde";
const START_DATE = new Date("2026-01-01T00:00:00.000Z");
const END_DATE = new Date("2026-12-31T23:59:59.999Z");
const TICKET_TYPE_NAME = "Tristar Oelde Mitglied";

async function main() {
  const verein = await prisma.verein.findUnique({
    where: { accountId_name: { accountId: ACCOUNT_ID, name: VEREIN_NAME } },
  });
  if (!verein) throw new Error(`Verein "${VEREIN_NAME}" nicht gefunden`);

  const members = await prisma.ticket.findMany({
    where: { accountId: ACCOUNT_ID, vereinId: verein.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      startDate: true,
      endDate: true,
      ticketTypeName: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  console.log(`${members.length} Mitglieder im Verein "${VEREIN_NAME}".`);

  let updated = 0;
  let unchanged = 0;
  let typeKept = 0;

  for (const m of members) {
    const patch: Record<string, unknown> = {};

    const sameStart = m.startDate?.getTime() === START_DATE.getTime();
    const sameEnd = m.endDate?.getTime() === END_DATE.getTime();
    if (!sameStart) patch.startDate = START_DATE;
    if (!sameEnd) patch.endDate = END_DATE;

    // ticketTypeName nur setzen, wenn er aktuell leer ist – wir wollen
    // bestehende manuelle Typen (z. B. "Trainer", "Vorstand") nicht
    // ueberschreiben.
    if (!m.ticketTypeName || m.ticketTypeName.trim() === "") {
      patch.ticketTypeName = TICKET_TYPE_NAME;
    } else {
      typeKept++;
    }

    if (Object.keys(patch).length === 0) {
      unchanged++;
      continue;
    }

    await prisma.ticket.update({
      where: { id: m.id },
      data: patch,
    });
    updated++;
    console.log(
      `  ~ #${m.id} ${m.firstName ?? ""} ${m.lastName ?? ""}: ${Object.keys(patch).join(", ")}`,
    );
  }

  console.log("\nFertig:");
  console.log(`  aktualisiert:                ${updated}`);
  console.log(`  unveraendert:                ${unchanged}`);
  console.log(`  individueller Tickettyp behalten: ${typeKept}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
