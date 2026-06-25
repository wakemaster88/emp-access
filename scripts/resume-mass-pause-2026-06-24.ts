/**
 * Einmal-Skript: Macht die versehentliche Massen-Pause vom 24.06.2026 um
 * ~16:11 Berlin (UTC 14:11:08-14:11:11) rueckgaengig.
 *
 * Ursache: pause-all hat den `monitor.areaIds`-Scope ignoriert und bei einem
 * bereichseingegrenzten Seilbahn-A-Monitor (ohne eigenes Scan-Geraet) kontoweit
 * pausiert -> 929 Tickets ueber alle Bereiche (Seilbahn A, Strandbad, Aquapark,
 * Wake&Ski, Ferienkurs, Universal-Tickets ohne Bereich).
 *
 * Spiegelt die "resume"-Logik aus
 * `src/app/api/monitor/public/[token]/pause-all/route.ts`:
 *  - DURATION-Tickets mit `extras.remainingMs`: firstScanAt rekonstruieren,
 *    extras aufraeumen, status=VALID.
 *  - Alle anderen PAUSED-Tickets aus dem Fenster: status=VALID.
 *
 * Sicherheits-Scope:
 *  - status    = PAUSED
 *  - updatedAt zwischen 2026-06-24 14:11:07Z und 2026-06-24 14:11:12Z
 *  - Zahlungs-Pausen (extras.paymentPause) werden AUSGESCHLOSSEN.
 *
 * Spaetere manuelle Einzel-Pausen (15:15, 15:31, 18:41) liegen ausserhalb des
 * Fensters und werden NICHT angefasst.
 *
 * Aufruf:
 *   npx tsx scripts/resume-mass-pause-2026-06-24.ts            # dry run
 *   APPLY=1 npx tsx scripts/resume-mass-pause-2026-06-24.ts    # tatsaechlich anwenden
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const WINDOW_START = new Date("2026-06-24T14:11:07.000Z");
const WINDOW_END = new Date("2026-06-24T14:11:12.000Z");

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(`Modus: ${apply ? "APPLY (schreibt)" : "DRY RUN (nichts wird geaendert)"}`);
  console.log(
    `Scope: status=PAUSED, updatedAt ${WINDOW_START.toISOString()} - ${WINDOW_END.toISOString()}\n`,
  );

  const candidates = await prisma.ticket.findMany({
    where: {
      status: "PAUSED",
      updatedAt: { gte: WINDOW_START, lte: WINDOW_END },
    },
    select: {
      id: true,
      accountId: true,
      accessAreaId: true,
      validityType: true,
      validityDurationMinutes: true,
      extras: true,
      accessArea: { select: { name: true } },
    },
  });

  // Zahlungs-Pausen ausschliessen - die haben einen eigenen Lifecycle und
  // werden automatisch wieder aktiv, sobald die Rechnung bezahlt ist.
  const targets = candidates.filter((t) => {
    const ext = (t.extras as Record<string, unknown> | null) ?? {};
    return !ext.paymentPause;
  });
  const skippedPayment = candidates.length - targets.length;

  // Aufschluesselung nach Bereich (Kontrolle).
  const byArea = new Map<string, number>();
  for (const t of targets) {
    const label = t.accessAreaId == null ? "—(kein Bereich)" : `${t.accessAreaId}:${t.accessArea?.name ?? "?"}`;
    byArea.set(label, (byArea.get(label) ?? 0) + 1);
  }
  console.log(`Kandidaten im Fenster: ${candidates.length}`);
  console.log(`  davon Zahlungs-Pausen uebersprungen: ${skippedPayment}`);
  console.log(`  zu reaktivieren:                     ${targets.length}\n`);
  console.log("Aufschluesselung nach Bereich:");
  for (const [k, v] of [...byArea.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log("");

  const durationTargets = targets.filter((t) => t.validityType === "DURATION");
  const otherTargets = targets.filter((t) => t.validityType !== "DURATION");

  const now = new Date();
  let durationResumed = 0;
  let durationRecomputed = 0;
  let bulkUpdated = 0;

  if (apply) {
    for (const t of durationTargets) {
      const ext = (t.extras as Record<string, unknown> | null) ?? {};
      let firstScanAt: Date | undefined;
      if (typeof ext.remainingMs === "number" && t.validityDurationMinutes != null) {
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

    const res = await prisma.ticket.updateMany({
      where: { id: { in: otherTargets.map((t) => t.id) } },
      data: { status: "VALID" },
    });
    bulkUpdated = res.count;
  } else {
    durationRecomputed = durationTargets.filter((t) => {
      const ext = (t.extras as Record<string, unknown> | null) ?? {};
      return typeof ext.remainingMs === "number";
    }).length;
  }

  console.log("Zusammenfassung:");
  console.log(
    `  DURATION zurueckgesetzt: ${apply ? durationResumed : durationTargets.length} (firstScanAt rekonstruiert: ${durationRecomputed})`,
  );
  console.log(`  Sonstige auf VALID:      ${apply ? bulkUpdated : otherTargets.length}`);
  console.log(
    `  Gesamt entpaust:         ${apply ? durationResumed + bulkUpdated : targets.length}`,
  );
  if (!apply) {
    console.log("\nDry run beendet. Zum Anwenden:");
    console.log("  APPLY=1 npx tsx scripts/resume-mass-pause-2026-06-24.ts");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
