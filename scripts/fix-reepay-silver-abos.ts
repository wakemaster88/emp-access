/**
 * Einmal-Skript: Korrigiert die Reepay-Silver-Abos (= Beach Abo,
 * subscriptionId=1) im EMP-Access auf den aktuellen Reepay-Stand.
 *
 * Hintergrund:
 * Beim damaligen Reepay-Import wurde endDate fest auf "startDate + 12 Monate"
 * gesetzt. Reepay-Abos haben aber kein hartes Vertragsende: nach Ablauf der
 * Mindestlaufzeit laufen sie monatlich auto-renewed weiter, bis aktiv
 * gekueundigt wird. Folge: Aboinhaber, deren erste 12 Monate vorbei sind,
 * sind im EMP-Access auf INVALID, obwohl sie im Reepay weiterhin ACTIVE sind
 * (= sie zahlen weiter).
 *
 * Quelle der Korrektur: Reepay-Subscriptions-CSV-Export vom 28.05.2026.
 *
 * - 13 ACTIVE-Silver-Abos: status -> VALID, endDate -> 30.04.2027
 *   (Saisonende 2026 + 1 Jahr; Twincable Beckum ist Saisonpark)
 * - 1 ON_HOLD-Silver-Abo (sub-0315 Ruven Neufeld): status -> PAUSED
 *
 * Aufruf:
 *   npx tsx scripts/fix-reepay-silver-abos.ts
 *   DRY_RUN=1 npx tsx scripts/fix-reepay-silver-abos.ts   # nur loggen
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const DRY_RUN = process.env.DRY_RUN === "1";

// Saisonende 2026 + 1 Jahr Karenz; vor naechster Saison wird das via Sync neu
// gesetzt (oder per Folge-Skript verlaengert, falls Reepay weiter ACTIVE).
const SEASON_END_2026 = new Date("2027-04-30T23:59:59.999Z");

// Aus dem Reepay-CSV (twincable-silver-abo, state=ACTIVE) extrahiert.
// Alle 20 sind im Reepay laufend - im EMP-Access setzen wir endDate auf
// das Saisonende, damit das alte 1-Jahres-endDate keinen falschen INVALID
// erzeugt. Die ersten 13 sind aktuell faelschlich INVALID, die letzten 7
// sind VALID, laufen aber demnaechst aus (alte +1Y Logik).
const REACTIVATE_UUIDS = [
  "reepay:sub-0225", // Oliver Neugebauer    (INVALID)
  "reepay:sub-0229", // Annette Moellmann    (INVALID)
  "reepay:sub-0230", // Thomas Moellmann     (INVALID)
  "reepay:sub-0232", // Nico Moellmann       (INVALID)
  "reepay:sub-0236", // Florian Strotmeier   (INVALID)
  "reepay:sub-0241", // Rebecca Koepe        (INVALID)
  "reepay:sub-0242", // Gert Klaus Waehle    (INVALID)
  "reepay:sub-0243", // Nina Meyer           (INVALID)
  "reepay:sub-0244", // Joerg Kellner        (INVALID)
  "reepay:sub-0270", // Jaroslaw Salwasser   (INVALID)
  "reepay:sub-0273", // Thomas Zurek         (INVALID)
  "reepay:sub-0278", // Alexander Sauer      (INVALID)
  "reepay:sub-0288", // Joachim Agater       (INVALID)
  "reepay:sub-0323", // Noah Moellmann       (VALID, laeuft 16.06.2026 aus)
  "reepay:sub-0330", // Denis Gaertner       (VALID, laeuft 22.06.2026 aus)
  "reepay:sub-0334", // Giuseppe Squarcia    (VALID, laeuft 30.06.2026 aus)
  "reepay:sub-0335", // Heinrich Abrams      (VALID, laeuft 01.07.2026 aus)
  "reepay:sub-0336", // Dietmar Brestel      (VALID, laeuft 01.07.2026 aus)
  "reepay:sub-0337", // Gunilla Brestel      (VALID, laeuft 01.07.2026 aus)
  "reepay:sub-0351", // Tamas Asthoff        (VALID, laeuft 04.08.2026 aus)
];

// ON_HOLD im Reepay -> PAUSED im EMP-Access
const PAUSE_UUIDS = [
  "reepay:sub-0315", // Ruven Neufeld
];

async function main() {
  console.log(`Modus: ${DRY_RUN ? "DRY_RUN" : "WRITE"}`);
  console.log(`Saisonende: ${SEASON_END_2026.toISOString()}`);
  console.log("");

  let reactivated = 0;
  let paused = 0;
  const skipped: string[] = [];

  for (const uuid of REACTIVATE_UUIDS) {
    const t = await prisma.ticket.findFirst({
      where: { uuid },
      select: { id: true, name: true, status: true, endDate: true, accountId: true },
    });
    if (!t) {
      skipped.push(`${uuid} - nicht gefunden`);
      continue;
    }
    console.log(
      `Reactivate ${uuid} (#${t.id} "${t.name}"): status ${t.status} -> VALID, endDate ${
        t.endDate?.toISOString().slice(0, 10) ?? "-"
      } -> ${SEASON_END_2026.toISOString().slice(0, 10)}`,
    );
    if (!DRY_RUN) {
      await prisma.ticket.update({
        where: { id: t.id },
        data: {
          status: "VALID",
          endDate: SEASON_END_2026,
          version: { increment: 1 },
        },
      });
    }
    reactivated++;
  }

  for (const uuid of PAUSE_UUIDS) {
    const t = await prisma.ticket.findFirst({
      where: { uuid },
      select: { id: true, name: true, status: true, accountId: true },
    });
    if (!t) {
      skipped.push(`${uuid} - nicht gefunden`);
      continue;
    }
    console.log(`Pause     ${uuid} (#${t.id} "${t.name}"): status ${t.status} -> PAUSED`);
    if (!DRY_RUN) {
      await prisma.ticket.update({
        where: { id: t.id },
        data: { status: "PAUSED", version: { increment: 1 } },
      });
    }
    paused++;
  }

  console.log("");
  console.log(`Reaktiviert: ${reactivated}`);
  console.log(`Pausiert:    ${paused}`);
  if (skipped.length > 0) {
    console.log(`Skipped:     ${skipped.length}`);
    for (const s of skipped) console.log(`  - ${s}`);
  }

  // -- Liste aller Beach-Abos (subscriptionId=1) ausgeben --
  console.log("");
  console.log("=== Alle Beach-Abos (subscriptionId=1) ===");
  const all = await prisma.ticket.findMany({
    where: { accountId: 1, subscriptionId: 1 },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      uuid: true,
      name: true,
      ticketTypeName: true,
      status: true,
      source: true,
      startDate: true,
      endDate: true,
    },
  });
  console.log(`Total: ${all.length}`);
  console.log("");
  for (const t of all) {
    const start = t.startDate?.toISOString().slice(0, 10) ?? "-";
    const end = t.endDate?.toISOString().slice(0, 10) ?? "-";
    const src = t.source ?? "-";
    const type = t.ticketTypeName ?? "-";
    console.log(
      `${t.status.padEnd(8)} | ${src.padEnd(5)} | ${type.padEnd(20)} | ${start} -> ${end} | ${
        t.uuid ?? `id=${t.id}`
      } | ${t.name}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
