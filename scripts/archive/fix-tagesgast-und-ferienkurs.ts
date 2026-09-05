/**
 * Bindet die gedruckten "Tagesgast"-Bulk-Karten an den Service
 * "Strandbad - Tageskarte" (inkl. Bereich Strandbad) und setzt die
 * Hauptressource des Ferienkurs-Service.
 *
 * Warum:
 * - Die Tagesgast-Karten haben weder Service noch Bereich. Ohne Service greift
 *   `allowReentry` nicht: nach dem ersten Eintritt sind sie gesperrt und ein
 *   Ausgangs-Scan macht sie nicht wieder gueltig (`shouldResetValid` verlangt
 *   `service.allowReentry`). Ohne Bereich greift die Bereichspruefung nicht -
 *   sie oeffnen derzeit JEDES Geraet, auch Seilbahn A.
 * - Der Ferienkurs-Service hat keine Hauptressource. Damit zaehlt jeder Scan
 *   als verbrauchend, auch am Strandbad-Drehkreuz, wo Kurstickets Transit
 *   sein sollen.
 *
 * Default ist Dry-Run. Anwenden mit:
 *   APPLY=1 npx tsx scripts/fix-tagesgast-und-ferienkurs.ts
 *
 * Optional nur neuere Karten anfassen (Default: alle):
 *   MAX_AGE_DAYS=60 npx tsx scripts/fix-tagesgast-und-ferienkurs.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const APPLY = process.env.APPLY === "1";
const MAX_AGE_DAYS = process.env.MAX_AGE_DAYS ? Number(process.env.MAX_AGE_DAYS) : null;

const STRANDBAD_TAGESKARTE_SERVICE = 4;
const STRANDBAD_AREA = 8;
const FERIENKURS_SERVICE = 6;
const FERIENKURS_AREA = 11;

async function main() {
  console.log(APPLY ? "== ANWENDEN ==" : "== DRY-RUN (nichts wird geschrieben) ==");
  if (MAX_AGE_DAYS) console.log(`   Nur Karten der letzten ${MAX_AGE_DAYS} Tage.`);

  // Plausibilitaet: Ziel-Service und -Bereiche existieren wie erwartet?
  const svc = await prisma.service.findUnique({
    where: { id: STRANDBAD_TAGESKARTE_SERVICE },
    select: {
      id: true, name: true, allowReentry: true, mainAccessAreaId: true, accountId: true,
      serviceAreas: { select: { accessAreaId: true } },
    },
  });
  const ferien = await prisma.service.findUnique({
    where: { id: FERIENKURS_SERVICE },
    select: {
      id: true, name: true, mainAccessAreaId: true, accountId: true,
      serviceAreas: { select: { accessAreaId: true } },
    },
  });
  if (!svc || !ferien) throw new Error("Ziel-Services nicht gefunden - IDs pruefen.");
  console.log(
    `\nZiel-Service: #${svc.id} "${svc.name}" allowReentry=${svc.allowReentry} ` +
      `bereiche=[${svc.serviceAreas.map((s) => s.accessAreaId).join(", ")}]`,
  );
  console.log(
    `Ferienkurs:   #${ferien.id} "${ferien.name}" main=${ferien.mainAccessAreaId ?? "—"} ` +
      `bereiche=[${ferien.serviceAreas.map((s) => s.accessAreaId).join(", ")}]`,
  );
  if (!svc.serviceAreas.some((s) => s.accessAreaId === STRANDBAD_AREA)) {
    throw new Error("Service 4 hat den Bereich Strandbad nicht - abgebrochen.");
  }
  if (!ferien.serviceAreas.some((s) => s.accessAreaId === FERIENKURS_AREA)) {
    throw new Error("Service 6 hat den Bereich Ferienkurs nicht - Hauptressource muss Teil der Bereiche sein.");
  }

  // --- 1) Tagesgast-Karten ---
  const where = {
    name: { startsWith: "Tagesgast" },
    serviceId: null,
    accessAreaId: null,
    subscriptionId: null,
    vereinId: null,
    accountId: svc.accountId,
    ...(MAX_AGE_DAYS
      ? { createdAt: { gte: new Date(Date.now() - MAX_AGE_DAYS * 24 * 3600_000) } }
      : {}),
  } as const;

  const byStatus = await prisma.ticket.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const total = byStatus.reduce((s, r) => s + r._count._all, 0);
  console.log(`\n=== Tagesgast-Karten ohne Service/Bereich: ${total} ===`);
  for (const r of byStatus) console.log(`  ${r._count._all}x ${r.status}`);

  const dateless = await prisma.ticket.count({ where: { ...where, startDate: null, endDate: null } });
  console.log(`  davon ohne Start-/Enddatum (laufen nie ab): ${dateless}`);

  const withCodes = await prisma.ticket.count({
    where: { ...where, OR: [{ qrCode: { not: null } }, { rfidCode: { not: null } }, { barcode: { not: null } }] },
  });
  console.log(`  davon mit Scan-Code: ${withCodes}`);

  if (APPLY) {
    const res = await prisma.ticket.updateMany({
      where,
      data: {
        serviceId: STRANDBAD_TAGESKARTE_SERVICE,
        accessAreaId: STRANDBAD_AREA,
        version: { increment: 1 },
      },
    });
    console.log(`  -> ${res.count} Karten auf Service #${STRANDBAD_TAGESKARTE_SERVICE} + Bereich #${STRANDBAD_AREA} gesetzt.`);
  } else {
    console.log(`  -> wuerde ${total} Karten auf Service #${STRANDBAD_TAGESKARTE_SERVICE} + Bereich #${STRANDBAD_AREA} setzen.`);
  }

  // --- 2) Ferienkurs-Hauptressource ---
  console.log(`\n=== Ferienkurs-Hauptressource ===`);
  if (ferien.mainAccessAreaId === FERIENKURS_AREA) {
    console.log("  bereits gesetzt - nichts zu tun.");
  } else if (APPLY) {
    await prisma.service.update({
      where: { id: FERIENKURS_SERVICE },
      data: { mainAccessAreaId: FERIENKURS_AREA },
    });
    console.log(`  -> Hauptressource auf Bereich #${FERIENKURS_AREA} (Ferienkurs) gesetzt.`);
  } else {
    console.log(`  -> wuerde Hauptressource auf Bereich #${FERIENKURS_AREA} (Ferienkurs) setzen.`);
  }

  // --- 3) Warnung: datumslose Strandbad-Tickets sind unbegrenzt gueltig ---
  const openEnded = await prisma.ticket.count({
    where: {
      serviceId: { in: [STRANDBAD_TAGESKARTE_SERVICE, 5] },
      endDate: null,
      status: { in: ["VALID", "REDEEMED"] },
    },
  });
  const withEnd = await prisma.ticket.count({
    where: { serviceId: { in: [STRANDBAD_TAGESKARTE_SERVICE, 5] }, endDate: { not: null } },
  });
  console.log(`\n=== Hinweis: Strandbad-Tickets ohne Enddatum ===`);
  console.log(`  ohne Enddatum (VALID/REDEEMED): ${openEnded}`);
  console.log(`  mit Enddatum: ${withEnd}`);
  console.log(
    "  Ohne Enddatum greift weder die Ablaufpruefung noch der Cleanup-Cron.\n" +
      "  Zusammen mit allowReentry heisst das: ein Ausgangs-Scan macht auch eine\n" +
      "  alte Karte wieder gueltig. Separat zu klaeren.",
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
