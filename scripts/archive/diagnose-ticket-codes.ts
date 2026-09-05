/**
 * Diagnose: Warum loest ein Scan auf das "falsche" Ticket auf?
 *
 * Typischer Fall: Eine Person hat ein gueltiges Abo UND ein altes Einzel-
 * Zeitticket (DURATION) auf derselben Karte/demselben Code. Da rfidCode/
 * qrCode im Schema NICHT eindeutig sind (nur barcode/uuid), matcht der Scan
 * mehrere Tickets – und die Auswahl konnte frueher das abgelaufene Zeitticket
 * dem Abo vorziehen ("Zeitticket abgelaufen" trotz gueltigem Abo).
 *
 * Das Script ist READ-ONLY (schreibt nichts). Es zeigt:
 *   - Alle Tickets einer Person (per Name) mit Status/Gueltigkeit/Codes
 *   - Codes, die an MEHREREN Tickets haengen (Duplikate)
 *   - Fuer einen gescannten Code: welche Tickets matchen und welches die
 *     aktuelle Auswahl-Logik (pickBestScanCandidate) waehlen wuerde
 *   - Die heutigen Scans (Europe/Berlin) der betroffenen Tickets
 *
 * Aufruf:
 *   NAME="Leon Ossadchiy" npx tsx scripts/diagnose-ticket-codes.ts
 *   CODE="0506339173"     npx tsx scripts/diagnose-ticket-codes.ts
 *   NAME="Leon" ACCOUNT_ID=1 npx tsx scripts/diagnose-ticket-codes.ts
 *   TICKET_ID=1234 npx tsx scripts/diagnose-ticket-codes.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { buildScanCodeVariants } from "../../src/lib/scan-code-variants";
import {
  pickBestScanCandidate,
  scanCandidateScore,
  isDurationExpired,
} from "../../src/lib/scan-candidate";
import { berlinDayStart } from "../../src/lib/berlin-day";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const TICKET_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  ticketTypeName: true,
  status: true,
  validityType: true,
  validityDurationMinutes: true,
  firstScanAt: true,
  startDate: true,
  endDate: true,
  slotStart: true,
  slotEnd: true,
  rfidCode: true,
  qrCode: true,
  barcode: true,
  uuid: true,
  subscriptionId: true,
  vereinId: true,
  serviceId: true,
  accountId: true,
  subscription: { select: { name: true } },
  service: { select: { name: true } },
} as const;

type TicketRow = {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  status: string;
  validityType: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  slotStart: string | null;
  slotEnd: string | null;
  rfidCode: string | null;
  qrCode: string | null;
  barcode: string | null;
  uuid: string | null;
  subscriptionId: number | null;
  vereinId: number | null;
  serviceId: number | null;
  accountId: number;
  subscription: { name: string } | null;
  service: { name: string } | null;
};

const day = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }) : "—";
const ts = (d: Date | null) =>
  d ? new Date(d).toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }) : "—";

function describe(t: TicketRow, now: Date): string {
  const person =
    [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
  const kind =
    t.subscriptionId != null ? `Abo: ${t.subscription?.name ?? "?"}`
    : t.vereinId != null ? "Vereinsmitglied"
    : t.service?.name ? `Service: ${t.service.name}`
    : t.ticketTypeName ?? "Einzelticket";
  const validity =
    t.validityType === "DURATION"
      ? `DURATION ${t.validityDurationMinutes ?? "?"}min firstScan=${ts(t.firstScanAt)}${
          isDurationExpired(t, now) ? " [ABGELAUFEN]" : ""
        }`
      : t.validityType === "TIME_SLOT"
        ? `TIME_SLOT ${t.slotStart ?? "?"}-${t.slotEnd ?? "?"}`
        : "DATE_RANGE";
  const codes = [
    t.rfidCode ? `rfid=${t.rfidCode}` : null,
    t.qrCode ? `qr=${t.qrCode}` : null,
    t.barcode ? `barcode=${t.barcode}` : null,
    t.uuid ? `uuid=${t.uuid}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    `  #${t.id} acc=${t.accountId} "${person}" [${t.status}] ${kind}\n` +
    `      gueltig=${day(t.startDate)}..${day(t.endDate)} ${validity}\n` +
    `      codes: ${codes || "— (kein scanbarer Code!)"}\n` +
    `      score=${scanCandidateScore(t, now)}`
  );
}

/**
 * Codes, die an MEHREREN (verschiedenen) Tickets haengen. Derselbe Code in
 * rfid/qr/barcode EINES Tickets zaehlt nicht als Duplikat – nur ticket-
 * uebergreifende Mehrfachvergabe ist das Problem.
 */
function findSharedCodes(tickets: TicketRow[]): Map<string, number[]> {
  const byCode = new Map<string, Set<number>>();
  for (const t of tickets) {
    for (const c of [t.rfidCode, t.qrCode, t.barcode]) {
      if (!c) continue;
      const set = byCode.get(c) ?? new Set<number>();
      set.add(t.id);
      byCode.set(c, set);
    }
  }
  return new Map(
    [...byCode.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([code, ids]) => [code, [...ids]] as [string, number[]]),
  );
}

async function printTodayScans(ticketIds: number[]) {
  if (ticketIds.length === 0) return;
  const scans = await prisma.scan.findMany({
    where: { ticketId: { in: ticketIds }, scanTime: { gte: berlinDayStart() } },
    orderBy: { scanTime: "desc" },
    select: {
      id: true,
      scanTime: true,
      result: true,
      note: true,
      code: true,
      ticketId: true,
      device: { select: { name: true } },
    },
  });
  console.log(`\n— Heutige Scans (Europe/Berlin): ${scans.length} —`);
  for (const s of scans) {
    console.log(
      `  ${ts(s.scanTime)} ticket#${s.ticketId ?? "—"} [${s.result}]` +
        `${s.note ? ` note=${s.note}` : ""} device="${s.device?.name ?? "—"}" code=${s.code}`,
    );
  }
}

async function main() {
  const NAME = process.env.NAME?.trim();
  const CODE = process.env.CODE?.trim();
  const ACCOUNT_ID = process.env.ACCOUNT_ID ? Number(process.env.ACCOUNT_ID) : null;
  const TICKET_ID = process.env.TICKET_ID ? Number(process.env.TICKET_ID) : null;
  const now = new Date();

  if (!NAME && !CODE && !TICKET_ID) {
    console.error(
      "Bitte mindestens NAME, CODE oder TICKET_ID setzen.\n" +
        '  NAME="Leon Ossadchiy" npx tsx scripts/diagnose-ticket-codes.ts',
    );
    process.exitCode = 1;
    return;
  }

  const accountFilter = ACCOUNT_ID != null ? { accountId: ACCOUNT_ID } : {};
  const relevantTicketIds = new Set<number>();

  // 1) Person per Name
  if (NAME) {
    const parts = NAME.split(/\s+/).filter(Boolean);
    const nameOr = [
      { name: { contains: NAME, mode: "insensitive" as const } },
      ...parts.map((p) => ({ firstName: { contains: p, mode: "insensitive" as const } })),
      ...parts.map((p) => ({ lastName: { contains: p, mode: "insensitive" as const } })),
    ];
    const tickets = (await prisma.ticket.findMany({
      where: { ...accountFilter, OR: nameOr },
      orderBy: [{ accountId: "asc" }, { id: "asc" }],
      select: TICKET_SELECT,
    })) as TicketRow[];

    console.log(`\n=== Tickets fuer "${NAME}" (${tickets.length}) ===`);
    for (const t of tickets) {
      console.log(describe(t, now));
      relevantTicketIds.add(t.id);
    }

    const shared = findSharedCodes(tickets);
    if (shared.size > 0) {
      console.log(`\n*** WARNUNG: Code an mehreren Tickets (Duplikate) ***`);
      for (const [code, ids] of shared) {
        console.log(`  code="${code}" -> tickets ${ids.map((i) => `#${i}`).join(", ")}`);
      }
    }
  }

  // 2) Einzelnes Ticket per ID
  if (TICKET_ID) {
    const t = (await prisma.ticket.findUnique({
      where: { id: TICKET_ID },
      select: TICKET_SELECT,
    })) as TicketRow | null;
    console.log(`\n=== Ticket #${TICKET_ID} ===`);
    if (!t) {
      console.log("  Nicht gefunden.");
    } else {
      console.log(describe(t, now));
      relevantTicketIds.add(t.id);
    }
  }

  // 3) Scan-Simulation fuer einen Code: exakt wie die Scan-Route matchen.
  if (CODE) {
    const variants = buildScanCodeVariants(CODE);
    console.log(`\n=== Scan-Simulation fuer Code "${CODE}" ===`);
    console.log(`  Code-Varianten: ${variants.join(", ")}`);

    let matched: TicketRow[] = [];
    let usedVariant: string | null = null;
    for (const c of variants) {
      const candidates = (await prisma.ticket.findMany({
        where: {
          ...accountFilter,
          OR: [{ qrCode: c }, { rfidCode: c }, { barcode: c }, { uuid: c }],
        },
        select: TICKET_SELECT,
      })) as TicketRow[];
      if (candidates.length > 0) {
        matched = candidates;
        usedVariant = c;
        break;
      }
    }

    if (matched.length === 0) {
      console.log("  Kein Ticket gefunden (Scan -> 'Ticket nicht gefunden').");
    } else {
      console.log(`  Treffer ueber Variante "${usedVariant}": ${matched.length} Ticket(s)`);
      const picked = pickBestScanCandidate(matched, now);
      for (const t of matched) {
        const isPicked = picked && t.id === picked.id;
        console.log(`${isPicked ? ">>" : "  "}${describe(t, now).slice(2)}`);
        relevantTicketIds.add(t.id);
      }
      if (picked) {
        const person =
          [picked.firstName, picked.lastName].filter(Boolean).join(" ") || picked.name;
        console.log(
          `\n  => Ausgewaehlt: #${picked.id} "${person}" [${picked.status}]` +
            (isDurationExpired(picked, now) ? "  (DURATION abgelaufen!)" : ""),
        );
        if (matched.length > 1) {
          console.log(
            "  (Mehrere Treffer = Code an mehreren Tickets. Code eindeutig einem " +
              "Ticket zuordnen, um Fehlauswahl zu vermeiden.)",
          );
        }
      }
    }
  }

  await printTodayScans([...relevantTicketIds]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
