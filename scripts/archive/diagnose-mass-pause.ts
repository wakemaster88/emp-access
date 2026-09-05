/**
 * READ-ONLY Diagnose: Findet Massen-Pausen der letzten Tage.
 *
 * Gruppiert alle aktuell PAUSED-Tickets nach dem Sekunden-Zeitstempel von
 * `updatedAt`. Eine Massen-Pause (pause-all) schreibt sehr viele Tickets im
 * selben Sekundenfenster -> sticht als grosses Cluster heraus. Manuelle
 * Einzel-Pausen und Zahlungs-Pausen (extras.paymentPause) sind verteilt bzw.
 * separat ausgewiesen.
 *
 * Aufruf:
 *   npx tsx scripts/diagnose-mass-pause.ts          # letzte 3 Tage
 *   DAYS=7 npx tsx scripts/diagnose-mass-pause.ts    # letzte 7 Tage
 *
 * Aendert NICHTS an der Datenbank.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const days = Number(process.env.DAYS ?? "3") || 3;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  console.log(`READ-ONLY Diagnose. Fenster: seit ${since.toISOString()} (${days} Tage)\n`);

  const paused = await prisma.ticket.findMany({
    where: { status: "PAUSED", updatedAt: { gte: since } },
    select: {
      id: true,
      accountId: true,
      accessAreaId: true,
      validityType: true,
      updatedAt: true,
      extras: true,
      accessArea: { select: { name: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  console.log(`PAUSED-Tickets im Fenster gesamt: ${paused.length}\n`);

  // Zahlungs-Pausen separat ausweisen - die sollen NICHT entpaust werden.
  const isPaymentPause = (t: (typeof paused)[number]) => {
    const ext = (t.extras as Record<string, unknown> | null) ?? {};
    return !!ext.paymentPause;
  };
  const paymentPauses = paused.filter(isPaymentPause);
  const otherPauses = paused.filter((t) => !isPaymentPause(t));
  console.log(`  davon Zahlungs-Pausen (extras.paymentPause): ${paymentPauses.length}  <- werden NICHT angefasst`);
  console.log(`  davon sonstige Pausen:                       ${otherPauses.length}\n`);

  // Cluster nach Sekunden-Zeitstempel.
  const clusters = new Map<string, typeof paused>();
  for (const t of otherPauses) {
    const key = new Date(Math.floor(t.updatedAt.getTime() / 1000) * 1000).toISOString();
    const arr = clusters.get(key) ?? [];
    arr.push(t);
    clusters.set(key, arr);
  }

  const sorted = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log("Groesste updatedAt-Cluster (Verdacht auf Massen-Pause):\n");
  console.log("  count  updatedAt (UTC)            Bereiche (accessAreaId -> name : count)");
  for (const [key, arr] of sorted.slice(0, 15)) {
    const byArea = new Map<string, number>();
    for (const t of arr) {
      const label = t.accessAreaId == null ? "—(kein Bereich)" : `${t.accessAreaId}:${t.accessArea?.name ?? "?"}`;
      byArea.set(label, (byArea.get(label) ?? 0) + 1);
    }
    const areaStr = [...byArea.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
    const berlin = new Date(key).toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
    console.log(`  ${String(arr.length).padStart(5)}  ${key}  [${berlin} Berlin]`);
    console.log(`         -> ${areaStr}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
