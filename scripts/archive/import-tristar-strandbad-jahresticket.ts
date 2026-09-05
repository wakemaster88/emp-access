/**
 * One-off: Legt fuer den Verein "Tristar Oelde" ein "Strandbad Jahresticket 2026"
 * als Vereins-Zutritts-Ticket (VereinAccessTicket) an. Alle Mitglieder des
 * Vereins erben damit beim Scan Zugriff auf die Area "Strandbad" – gueltig
 * vom 01.01.2026 bis 31.12.2026.
 *
 * Idempotent: erneutes Ausfuehren erzeugt keine Duplikate.
 *
 * Run:  npx tsx scripts/import-tristar-strandbad-jahresticket.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import "dotenv/config";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ACCOUNT_ID = 1; // Tuttenbrocksee
const VEREIN_NAME = "Tristar Oelde";
const STRANDBAD_AREA_ID = 8;
const BEACH_ABO_SUBSCRIPTION_ID = 1;
const TICKET_NAME = "Tristar Oelde – Strandbad Jahresticket 2026";
const TICKET_TYPE_NAME = "Strandbad Jahresticket";
const YEAR = 2026;

async function main() {
  const verein = await prisma.verein.findUnique({
    where: { accountId_name: { accountId: ACCOUNT_ID, name: VEREIN_NAME } },
  });
  if (!verein) throw new Error(`Verein "${VEREIN_NAME}" nicht gefunden (accountId=${ACCOUNT_ID})`);
  console.log(`Verein: #${verein.id} ${verein.name}`);

  // Pruefe, ob bereits ein passendes Zutritts-Ticket fuer 2026 hinterlegt ist.
  const existingLink = await prisma.vereinAccessTicket.findFirst({
    where: {
      vereinId: verein.id,
      ticket: {
        accountId: ACCOUNT_ID,
        ticketTypeName: TICKET_TYPE_NAME,
        startDate: { gte: new Date(`${YEAR}-01-01T00:00:00.000Z`) },
        endDate: { lte: new Date(`${YEAR}-12-31T23:59:59.999Z`) },
      },
    },
    include: { ticket: true },
  });
  if (existingLink) {
    console.log(
      `Bereits vorhanden: Ticket #${existingLink.ticketId} "${existingLink.ticket.name}" ` +
        `– ueberspringe Anlage.`,
    );
    return;
  }

  const startDate = new Date(`${YEAR}-01-01T00:00:00.000Z`);
  const endDate = new Date(`${YEAR}-12-31T23:59:59.999Z`);

  const ticket = await prisma.ticket.create({
    data: {
      accountId: ACCOUNT_ID,
      name: TICKET_NAME,
      ticketTypeName: TICKET_TYPE_NAME,
      validityType: "DATE_RANGE",
      startDate,
      endDate,
      status: "VALID",
      accessAreaId: STRANDBAD_AREA_ID,
      subscriptionId: BEACH_ABO_SUBSCRIPTION_ID,
    },
  });
  console.log(
    `Neues Ticket: #${ticket.id} "${ticket.name}" (Area #${STRANDBAD_AREA_ID} Strandbad, ` +
      `${startDate.toISOString().slice(0, 10)} – ${endDate.toISOString().slice(0, 10)})`,
  );

  const link = await prisma.vereinAccessTicket.create({
    data: { vereinId: verein.id, ticketId: ticket.id },
  });
  console.log(`VereinAccessTicket angelegt: #${link.id} (Verein #${verein.id} → Ticket #${ticket.id})`);

  const memberCount = await prisma.ticket.count({
    where: { vereinId: verein.id, accountId: ACCOUNT_ID },
  });
  console.log(`\nFertig. ${memberCount} Mitglieder erben jetzt den Strandbad-Zutritt fuer 2026.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
