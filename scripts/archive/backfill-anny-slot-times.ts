/**
 * Traegt die Kurszeit (`slotStart`/`slotEnd`) an ANNY-Tickets nach, denen sie
 * fehlt - fuer Services, die ihre Plaetze pro Slot selbst verwalten
 * (`Service.slotCapacity`) oder deren Default-Gueltigkeit TIME_SLOT ist.
 *
 * Notwendig, weil die Anfaengerkurse Ende Juli auf DURATION umgestellt wurden:
 * seitdem schrieb der Sync keine Slot-Zeit mehr ans Ticket und die Buchungen
 * landeten im Monitor unter "Ohne feste Uhrzeit" statt bei ihrem Kurstermin.
 * Neue Buchungen bekommen die Zeit wieder ueber `annyTicketSlotTimes`; dieses
 * Skript holt die bereits verkauften nach.
 *
 * Angefasst werden nur Tickets, deren Buchung an einem einzigen Berliner Tag
 * liegt und kein Ganztagesfenster ist - dieselbe Regel wie im Sync.
 *
 * Aufruf:
 *   npx tsx --env-file=.env.local scripts/backfill-anny-slot-times.ts          # Dry-Run
 *   APPLY=1 npx tsx --env-file=.env.local scripts/backfill-anny-slot-times.ts  # schreibt
 *
 * Standardmaessig ab heute-2 Tage. Weiter zurueck mit  DAYS_BACK=30.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { annyTicketSlotTimes } from "../../src/lib/anny-slot-time";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const berlin = (d: Date | null) =>
  d ? new Date(d).toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }) : "—";

async function main() {
  const apply = process.env.APPLY === "1";
  const daysBack = Number(process.env.DAYS_BACK ?? 2);
  console.log(apply ? "MODUS: APPLY (schreibt)\n" : "MODUS: DRY-RUN (zeigt nur, schreibt nichts)\n");

  const services = await prisma.service.findMany({
    select: { id: true, name: true, slotCapacity: true, defaultValidityType: true, defaultSlotStart: true, defaultSlotEnd: true },
  });
  const relevant = services.filter(
    (s) => (s.slotCapacity != null && s.slotCapacity > 0) || s.defaultValidityType === "TIME_SLOT",
  );
  if (relevant.length === 0) {
    console.log("Kein Service mit Slot-Verwaltung gefunden - nichts zu tun.");
    return;
  }
  console.log("Betroffene Services:");
  for (const s of relevant) {
    console.log(`  #${s.id} "${s.name}" slotCapacity=${s.slotCapacity ?? "—"} default=${s.defaultValidityType ?? "—"}`);
  }

  const from = new Date();
  from.setDate(from.getDate() - daysBack);
  from.setHours(0, 0, 0, 0);

  const tickets = await prisma.ticket.findMany({
    where: {
      source: "ANNY",
      serviceId: { in: relevant.map((s) => s.id) },
      slotStart: null,
      startDate: { gte: from },
      status: { in: ["VALID", "REDEEMED"] },
    },
    select: { id: true, name: true, serviceId: true, startDate: true, endDate: true, status: true },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });

  const svcById = new Map(relevant.map((s) => [s.id, s]));
  console.log(`\nTickets ohne Kurszeit ab ${berlin(from)}: ${tickets.length}\n`);

  let changed = 0;
  let skipped = 0;
  for (const t of tickets) {
    const svc = svcById.get(t.serviceId!);
    if (!svc) continue;
    const slot = annyTicketSlotTimes(
      {
        validityType: svc.defaultValidityType,
        slotStart: svc.defaultSlotStart,
        slotEnd: svc.defaultSlotEnd,
        slotManaged: svc.slotCapacity != null && svc.slotCapacity > 0,
      },
      t.startDate,
      t.endDate,
    );
    if (!("slotStart" in slot)) {
      skipped++;
      continue;
    }
    console.log(
      `  #${t.id} "${t.name}" ${svc.name} ${berlin(t.startDate)}-${berlin(t.endDate)}` +
        ` -> Slot ${slot.slotStart}-${slot.slotEnd}`,
    );
    if (apply) {
      await prisma.ticket.update({
        where: { id: t.id },
        data: { slotStart: slot.slotStart, slotEnd: slot.slotEnd },
      });
    }
    changed++;
  }

  console.log(
    `\n${apply ? "Nachgetragen" : "Wuerde nachtragen"}: ${changed} Ticket(s).` +
      ` Ohne ableitbare Kurszeit (mehrtaegig oder ganztaegig): ${skipped}.` +
      (apply ? "" : "\nZum Anwenden erneut mit  APPLY=1  ausfuehren."),
  );
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
