/**
 * Einmal-Skript: Macht die Massen-Pause vom 27.05.2026 um 15:08 Berlin
 * (UTC 13:08) rueckgaengig.
 *
 * Spiegelt die "resume"-Logik aus
 * `src/app/api/monitor/public/[token]/pause-all/route.ts`:
 *  - DURATION-Tickets mit `extras.pausedAtMs` + `extras.remainingMs`:
 *    firstScanAt rekonstruieren, extras aufraeumen, status=VALID.
 *  - Alle anderen PAUSED-Tickets aus dem Zeitfenster: status=VALID.
 *
 * Sicherheits-Scope:
 *  - accountId = 1 (tuttenbrocksee)
 *  - status    = PAUSED
 *  - updatedAt zwischen 2026-05-27 13:08:06Z und 2026-05-27 13:08:09Z
 *
 * Tickets, die ausserhalb dieses Fensters pausiert wurden (manuelle
 * Einzel-Pausen), werden NICHT angefasst.
 *
 * Aufruf:
 *   npx tsx scripts/resume-mass-pause.ts            # dry run
 *   APPLY=1 npx tsx scripts/resume-mass-pause.ts    # tatsaechlich anwenden
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const ACCOUNT_ID = 1;
const WINDOW_START = new Date("2026-05-27T13:08:06.000Z");
const WINDOW_END = new Date("2026-05-27T13:08:09.000Z");

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(
    `Modus: ${apply ? "APPLY (schreibt)" : "DRY RUN (nichts wird geaendert)"}`,
  );
  console.log(
    `Scope: accountId=${ACCOUNT_ID}, status=PAUSED, updatedAt ${WINDOW_START.toISOString()} - ${WINDOW_END.toISOString()}`,
  );

  const baseWhere: Prisma.TicketWhereInput = {
    accountId: ACCOUNT_ID,
    status: "PAUSED",
    updatedAt: { gte: WINDOW_START, lte: WINDOW_END },
  };

  const total = await prisma.ticket.count({ where: baseWhere });
  console.log(`Gefundene PAUSED-Tickets im Fenster: ${total}`);

  const durationTickets = await prisma.ticket.findMany({
    where: { ...baseWhere, validityType: "DURATION" },
    select: { id: true, validityDurationMinutes: true, extras: true },
  });
  console.log(`Davon DURATION: ${durationTickets.length}`);

  const now = new Date();
  let durationResumed = 0;
  let durationRecomputed = 0;

  if (apply) {
    for (const t of durationTickets) {
      const ext = (t.extras as Record<string, unknown> | null) ?? {};
      let firstScanAt: Date | undefined;
      if (
        typeof ext.remainingMs === "number" &&
        t.validityDurationMinutes != null
      ) {
        firstScanAt = new Date(
          now.getTime() - (t.validityDurationMinutes * 60_000 - (ext.remainingMs as number)),
        );
        durationRecomputed++;
      }
      delete ext.pausedAtMs;
      delete ext.remainingMs;
      delete ext.previousStatus;
      await prisma.ticket.update({
        where: { id: t.id },
        data: {
          status: "VALID",
          extras: ext as Prisma.InputJsonValue,
          ...(firstScanAt ? { firstScanAt } : {}),
        },
      });
      durationResumed++;
    }
  } else {
    for (const t of durationTickets) {
      const ext = (t.extras as Record<string, unknown> | null) ?? {};
      if (typeof ext.remainingMs === "number") durationRecomputed++;
    }
  }

  const durationIds = durationTickets.map((t) => t.id);
  const bulkWhere: Prisma.TicketWhereInput = {
    ...baseWhere,
    id: { notIn: durationIds },
  };
  const bulkCount = await prisma.ticket.count({ where: bulkWhere });

  let bulkUpdated = 0;
  if (apply) {
    const res = await prisma.ticket.updateMany({
      where: bulkWhere,
      data: { status: "VALID" },
    });
    bulkUpdated = res.count;
  }

  console.log("");
  console.log("Zusammenfassung:");
  console.log(`  DURATION einzeln zurueckgesetzt: ${apply ? durationResumed : durationTickets.length} (davon firstScanAt rekonstruiert: ${durationRecomputed})`);
  console.log(`  Bulk-Update auf VALID:           ${apply ? bulkUpdated : bulkCount}`);
  console.log(`  Gesamt entpaused:                ${apply ? durationResumed + bulkUpdated : durationTickets.length + bulkCount}`);
  if (!apply) {
    console.log("");
    console.log("Dry run beendet. Zum Anwenden:");
    console.log("  APPLY=1 npx tsx scripts/resume-mass-pause.ts");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
