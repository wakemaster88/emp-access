/**
 * Verifikation der Vorgaenger-Erkennung (`findPredecessorTicket`).
 *
 * Prueft READ-ONLY, ob fuer die Abo-Tickets ohne Karte ein Vorgaenger-Ticket
 * derselben Person gefunden wird - also ob die Karte beim Abo-Wechsel jetzt
 * automatisch mitgenommen wuerde.
 *
 * Aufruf:
 *   npx tsx scripts/verify-predecessor-lookup.ts
 *   TICKET_ID=8752 npx tsx scripts/verify-predecessor-lookup.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { findPredecessorTicket } from "../src/lib/ticket-predecessor";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const accountId = Number(process.env.ACCOUNT_ID ?? 1);
  const onlyId = process.env.TICKET_ID ? Number(process.env.TICKET_ID) : null;

  const candidates = await prisma.ticket.findMany({
    where: {
      accountId,
      status: "VALID",
      rfidCode: null,
      qrCode: null,
      barcode: null,
      subscription: { requiresRfid: true },
      ...(onlyId ? { id: onlyId } : {}),
    },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      subscription: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });

  console.log(`Abo-Tickets ohne Karte: ${candidates.length}\n`);

  let withCard = 0;
  for (const t of candidates) {
    const match = await findPredecessorTicket(prisma.ticket, accountId, {
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      excludeTicketId: t.id,
    });
    const person = [t.firstName, t.lastName].filter(Boolean).join(" ");
    if (match?.rfidCode) {
      withCard++;
      console.log(
        `  #${t.id} ${person} (${t.subscription?.name}) -> Karte von Ticket #${match.ticketId} (match=${match.matchedBy})`,
      );
    } else if (match?.profileImage) {
      console.log(`  #${t.id} ${person} -> nur Foto von #${match.ticketId}`);
    } else {
      console.log(`  #${t.id} ${person} -> kein Vorgaenger`);
    }
  }

  console.log(`\nMit uebernehmbarer Karte: ${withCard} von ${candidates.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
