/**
 * Einmal-Skript: Aendert die 3 Anfängerkurs-Seilbahn-B-Tickets von heute
 * 13:00 (Berlin) auf "Öffentlicher Betrieb - 2 Stunden".
 *
 * Konkret:
 *   - serviceId        -> 2 (Öffentlicher Betrieb - 2 Stunden)
 *   - accessAreaId     -> 5 (Seilbahn A, mainAccessAreaId des Service)
 *   - ticketTypeName   -> "Öffentlicher Betrieb - 2 Stunden"
 *   - validityType     -> DURATION
 *   - validityDurationMinutes -> 120
 *   - slotStart/slotEnd -> NULL
 *   - startDate        -> heute 00:00 Berlin (Tagesbeginn)
 *   - endDate          -> NULL (DURATION ignoriert endDate)
 *   - firstScanAt      -> NULL (Timer startet beim ersten Scan)
 *   - status           -> VALID
 *   - version          -> +1
 *   - ticketAreas      -> ersetzt durch alle ServiceAreas (Seilbahn A + Strandbad)
 *
 * Aufruf:
 *   npx tsx scripts/change-tickets-to-2h-oeffentlich.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const TICKET_IDS = [3573, 3577, 3578];
const TARGET_SERVICE_ID = 2;

async function main() {
  const targetService = await prisma.service.findUnique({
    where: { id: TARGET_SERVICE_ID },
    select: {
      id: true,
      name: true,
      mainAccessAreaId: true,
      defaultValidityType: true,
      defaultValidityDurationMinutes: true,
      accountId: true,
      serviceAreas: { select: { accessAreaId: true } },
    },
  });

  if (!targetService) {
    console.error(`Service #${TARGET_SERVICE_ID} nicht gefunden.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Ziel-Service: #${targetService.id} "${targetService.name}" ` +
      `(DURATION=${targetService.defaultValidityDurationMinutes}min, ` +
      `mainAccessAreaId=${targetService.mainAccessAreaId}, ` +
      `serviceAreas=[${targetService.serviceAreas.map((sa) => sa.accessAreaId).join(", ")}])`,
  );

  if (
    targetService.defaultValidityType !== "DURATION" ||
    targetService.defaultValidityDurationMinutes !== 120
  ) {
    console.error(
      `Service #${TARGET_SERVICE_ID} hat unerwartete Defaults: ` +
        `validityType=${targetService.defaultValidityType}, ` +
        `minutes=${targetService.defaultValidityDurationMinutes}. Abbruch.`,
    );
    process.exitCode = 1;
    return;
  }

  const tickets = await prisma.ticket.findMany({
    where: { id: { in: TICKET_IDS } },
    select: {
      id: true,
      name: true,
      ticketTypeName: true,
      status: true,
      firstScanAt: true,
      accountId: true,
      serviceId: true,
      accessAreaId: true,
      validityType: true,
      validityDurationMinutes: true,
      startDate: true,
      endDate: true,
    },
  });

  if (tickets.length !== TICKET_IDS.length) {
    console.error(
      `Erwartet ${TICKET_IDS.length} Tickets, gefunden ${tickets.length}.`,
    );
    process.exitCode = 1;
    return;
  }

  for (const t of tickets) {
    if (t.accountId !== targetService.accountId) {
      console.error(
        `Ticket #${t.id} gehoert zu Account ${t.accountId}, ` +
          `Service zu Account ${targetService.accountId}. Abbruch.`,
      );
      process.exitCode = 1;
      return;
    }
    if (t.firstScanAt) {
      console.error(
        `Ticket #${t.id} wurde bereits gescannt (firstScanAt=${t.firstScanAt.toISOString()}). ` +
          `Abbruch zur Sicherheit – bitte separat klaeren.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\nGefundene Tickets (${tickets.length}):`);
  for (const t of tickets) {
    console.log(
      `  #${t.id} "${t.name}" type="${t.ticketTypeName}" ` +
        `service=${t.serviceId} area=${t.accessAreaId} ` +
        `validity=${t.validityType} status=${t.status}`,
    );
  }

  const now = new Date();
  const berlinFormatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = berlinFormatter.format(now); // YYYY-MM-DD in Berlin
  const dayStartBerlinIso = new Date(`${today}T00:00:00+02:00`); // CEST (Mai)

  console.log(
    `\nNeuer startDate (Tagesbeginn Berlin): ${dayStartBerlinIso.toISOString()}`,
  );

  for (const t of tickets) {
    await prisma.$transaction([
      prisma.ticketArea.deleteMany({ where: { ticketId: t.id } }),
      prisma.ticket.update({
        where: { id: t.id },
        data: {
          serviceId: targetService.id,
          accessAreaId: targetService.mainAccessAreaId ?? null,
          ticketTypeName: targetService.name,
          validityType: "DURATION",
          validityDurationMinutes:
            targetService.defaultValidityDurationMinutes ?? 120,
          slotStart: null,
          slotEnd: null,
          startDate: dayStartBerlinIso,
          endDate: null,
          firstScanAt: null,
          status: "VALID",
          version: { increment: 1 },
          ticketAreas: {
            create: targetService.serviceAreas.map((sa) => ({
              accessAreaId: sa.accessAreaId,
            })),
          },
        },
      }),
    ]);
    console.log(`OK: Ticket #${t.id} aktualisiert.`);
  }

  console.log("\nFertig. Verifikation:");
  const after = await prisma.ticket.findMany({
    where: { id: { in: TICKET_IDS } },
    select: {
      id: true,
      name: true,
      ticketTypeName: true,
      serviceId: true,
      accessAreaId: true,
      validityType: true,
      validityDurationMinutes: true,
      slotStart: true,
      slotEnd: true,
      startDate: true,
      endDate: true,
      firstScanAt: true,
      status: true,
      version: true,
      ticketAreas: { select: { accessAreaId: true } },
    },
    orderBy: { id: "asc" },
  });
  for (const t of after) {
    console.log(
      `  #${t.id} "${t.name}" -> "${t.ticketTypeName}" ` +
        `service=${t.serviceId} area=${t.accessAreaId} ` +
        `validity=${t.validityType} dur=${t.validityDurationMinutes}min ` +
        `start=${t.startDate?.toISOString() ?? "—"} ` +
        `end=${t.endDate?.toISOString() ?? "—"} ` +
        `firstScan=${t.firstScanAt?.toISOString() ?? "—"} ` +
        `status=${t.status} v=${t.version} ` +
        `ticketAreas=[${t.ticketAreas.map((ta) => ta.accessAreaId).join(", ")}]`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
