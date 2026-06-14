/**
 * Einmal-Skript: Setzt ein Tagesgast-Ticket (DURATION) zurueck, damit es
 * neu gescannt werden kann.
 *
 * - Findet das Ticket per Name (Default "Tagesgast 3"), optional limitiert
 *   auf validityType=DURATION + validityDurationMinutes=60.
 * - Setzt status=VALID, firstScanAt=NULL, version+=1.
 * - Loescht heutige Scans NICHT (Audit bleibt erhalten).
 *
 * Aufruf:
 *   npx tsx scripts/reset-tagesgast.ts                # Default: "Tagesgast 3"
 *   TICKET_NAME="Tagesgast 5" npx tsx scripts/reset-tagesgast.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const name = process.env.TICKET_NAME?.trim() || "Tagesgast 3";

  const tickets = await prisma.ticket.findMany({
    where: {
      name,
      validityType: "DURATION",
      validityDurationMinutes: 60,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      firstScanAt: true,
      accessAreaId: true,
      accountId: true,
      service: { select: { name: true } },
      accessArea: { select: { name: true } },
    },
  });

  if (tickets.length === 0) {
    console.error(`Kein passendes Ticket "${name}" (DURATION 60min) gefunden.`);
    process.exitCode = 1;
    return;
  }

  if (tickets.length > 1) {
    console.log(`Gefundene Tickets (${tickets.length}):`);
    for (const t of tickets) {
      console.log(
        `  #${t.id} account=${t.accountId} status=${t.status} firstScanAt=${
          t.firstScanAt?.toISOString() ?? "—"
        } service="${t.service?.name ?? "—"}" hauptressource="${
          t.accessArea?.name ?? "—"
        }"`,
      );
    }
    console.error(
      "Mehrere Kandidaten gefunden. Bitte TICKET_NAME enger fassen oder TICKET_ID setzen.",
    );
    process.exitCode = 1;
    return;
  }

  const ticket = tickets[0];
  console.log(
    `Reset Ticket #${ticket.id} "${ticket.name}" (account=${ticket.accountId}, status=${ticket.status}, firstScanAt=${
      ticket.firstScanAt?.toISOString() ?? "—"
    })`,
  );

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      status: "VALID",
      firstScanAt: null,
      version: { increment: 1 },
    },
    select: { id: true, status: true, firstScanAt: true, version: true },
  });

  console.log(
    `OK: Ticket #${updated.id} jetzt status=${updated.status}, firstScanAt=${
      updated.firstScanAt?.toISOString() ?? "—"
    }, version=${updated.version}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
