/**
 * Konvertiert bereits verkaufte, OFFENE Anfängerkurs-Tickets von TIME_SLOT auf
 * DURATION 60 min - damit sie wie "Öffentlicher Betrieb - 1 Stunde" behandelt
 * werden (Strandbad = Transit, Zeitbudget am Lift, Reentry frei).
 *
 * Notwendig, weil der ANNY-Sync (`ticketChanged`) Validity-Aenderungen NICHT
 * erkennt und bestehende Tickets daher nicht automatisch umstellt.
 *
 * Zielmenge (konservativ):
 *   - serviceId in [8 Übungslift, 9 Seilbahn B]
 *   - status = VALID  (REDEEMED/in Benutzung bleibt unangetastet)
 *   - validityType = TIME_SLOT
 *   - endDate >= heute 00:00 (Berlin)  ODER  endDate = NULL  (nicht abgelaufen)
 *
 * Pro Ticket:
 *   - validityType -> DURATION, validityDurationMinutes -> 60
 *   - slotStart/slotEnd -> NULL
 *   - accessAreaId -> Service.mainAccessAreaId (Hauptressource)
 *   - ticketAreas -> ServiceAreas (Aktivitaet + Strandbad)
 *   - startDate/endDate bleiben (Kurstag), firstScanAt bleibt (bei VALID = NULL)
 *   - status bleibt VALID, version + 1
 *
 * Aufruf:
 *   npx tsx scripts/convert-open-anfaengerkurs-to-duration.ts          # Dry-Run
 *   APPLY=1 npx tsx scripts/convert-open-anfaengerkurs-to-duration.ts  # schreibt
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const SERVICE_IDS = [8, 9];
const DURATION_MINUTES = 60;

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(apply ? "MODUS: APPLY (schreibt)\n" : "MODUS: DRY-RUN (zeigt nur, schreibt nichts)\n");

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const services = await prisma.service.findMany({
    where: { id: { in: SERVICE_IDS } },
    select: { id: true, name: true, mainAccessAreaId: true,
      serviceAreas: { select: { accessAreaId: true } } },
  });
  const svcById = new Map(services.map((s) => [s.id, s]));

  // Zur Info: DATE_RANGE-Kurs-Tickets (offen) werden NICHT automatisch
  // konvertiert - Natur unklar (Einzeltag vs. Zeitraum). Nur zaehlen + zeigen.
  const dateRangeOpen = await prisma.ticket.count({
    where: { serviceId: { in: SERVICE_IDS }, status: "VALID", validityType: "DATE_RANGE",
      OR: [{ endDate: null }, { endDate: { gte: todayStart } }] },
  });

  const tickets = await prisma.ticket.findMany({
    where: {
      serviceId: { in: SERVICE_IDS },
      status: "VALID",
      validityType: "TIME_SLOT",
      OR: [{ endDate: null }, { endDate: { gte: todayStart } }],
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: {
      id: true, name: true, serviceId: true, accessAreaId: true,
      validityType: true, slotStart: true, slotEnd: true,
      startDate: true, endDate: true, firstScanAt: true, status: true,
    },
  });

  console.log(`Offene DATE_RANGE-Kurs-Tickets (NICHT angefasst): ${dateRangeOpen}`);
  console.log(`Zu konvertierende TIME_SLOT-Kurs-Tickets: ${tickets.length}\n`);

  let changed = 0;
  for (const t of tickets) {
    const svc = svcById.get(t.serviceId!);
    if (!svc) continue;
    const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }) : "—");
    console.log(
      `  #${t.id} "${t.name}" ${svc.name} ${day(t.startDate)} ` +
        `slot=${t.slotStart ?? "—"}-${t.slotEnd ?? "—"} -> DURATION ${DURATION_MINUTES}min ` +
        `main=${svc.mainAccessAreaId ?? "—"} areas=[${svc.serviceAreas.map((s) => s.accessAreaId).join(",")}]`,
    );

    if (apply) {
      await prisma.$transaction([
        prisma.ticketArea.deleteMany({ where: { ticketId: t.id } }),
        prisma.ticket.update({
          where: { id: t.id },
          data: {
            validityType: "DURATION",
            validityDurationMinutes: DURATION_MINUTES,
            slotStart: null,
            slotEnd: null,
            accessAreaId: svc.mainAccessAreaId ?? t.accessAreaId,
            version: { increment: 1 },
            ticketAreas: {
              create: svc.serviceAreas.map((sa) => ({ accessAreaId: sa.accessAreaId })),
            },
          },
        }),
      ]);
    }
    changed++;
  }

  console.log(
    `\n${apply ? "Konvertiert" : "Wuerde konvertieren"}: ${changed} Ticket(s).` +
      (apply ? "" : "\nZum Anwenden erneut mit  APPLY=1  ausfuehren."),
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
