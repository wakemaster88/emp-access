/**
 * Bändchen am Kunden: Datenbank-Seite zu `chip-rules.ts`.
 *
 * - `decideSale`: was beim Verkauf mit dem Code passiert (teilen, übergeben,
 *   Konflikt), mit dem gespeicherten Stand des Bändchens.
 * - `recordChipSale`: nach dem Verkauf Bändchen und Verlauf fortschreiben.
 * - `loadChipView`: das Kundenfenster an der Kasse (Person, Zahlen, letzte
 *   Käufe, Vorschlag).
 * - `createKonto`: „Kundenkonto anlegen“ an der Kasse.
 * - `undoSale`: „Rückgängig“ direkt nach dem Verkauf.
 *
 * Der Scan an Drehkreuz und Lift liest weiter nur `Ticket.rfidCode`.
 */
import { prisma, tenantClient } from "./prisma";
import { berlinYmd, berlinYearStart } from "./berlin-day";
import { buildScanCodeVariants } from "./scan-code-variants";
import { loadGamiConfig } from "./gamification-service";
import { countLinked } from "./day-guest";
import { ensureCustomer, syncKontoFamily, RiderError } from "./customers";
import { personDataKey } from "./customer-person";
import { newRiderToken } from "./rider-app";
import { maskEmail } from "./rider-reset-key";
import { cleanEmail } from "./abo-email";
import {
  ageAt,
  chipHolder,
  decideCodeUse,
  deriveOwner,
  isTicketInUse,
  suggestByHour,
  suggestFromHistory,
  type AnnyOrderView,
  type ChipOwnerKind,
  type ChipState,
  type ChipView,
  type ChipViewTicket,
  type CodeDecision,
  type CodeTicket,
  type HistoryState,
  type HourSales,
  type Suggestion,
} from "./chip-rules";

type Db = typeof prisma;
type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

const CODE_TICKET_SELECT = {
  id: true,
  riderProfileId: true,
  subscriptionId: true,
  vereinId: true,
  bulkBatchId: true,
  source: true,
  status: true,
  startDate: true,
  endDate: true,
  validityType: true,
  validityDurationMinutes: true,
  firstScanAt: true,
  slotStart: true,
  slotEnd: true,
  barcode: true,
  createdAt: true,
  firstName: true,
  lastName: true,
} as const;

/** Alle Tickets, an denen der Code steht (RFID, QR oder Barcode). */
export async function ticketsWithCode(db: Db | Tx, accountId: number, code: string): Promise<CodeTicket[]> {
  return db.ticket.findMany({
    where: { accountId, OR: [{ rfidCode: code }, { qrCode: code }, { barcode: code }] },
    select: CODE_TICKET_SELECT,
    orderBy: { id: "asc" },
    take: 500,
  });
}

export async function loadChip(db: Db | Tx, accountId: number, code: string) {
  return db.chip.findUnique({
    where: { accountId_code: { accountId, code } },
    select: { id: true, code: true, owner: true, riderProfileId: true, blockedAt: true },
  });
}

function chipState(chip: { owner: ChipOwnerKind; riderProfileId: number | null; blockedAt: Date | null } | null): ChipState | null {
  return chip ? { owner: chip.owner, riderProfileId: chip.riderProfileId, blockedAt: chip.blockedAt } : null;
}

function fullName(p: { firstName: string | null; lastName: string | null } | null | undefined): string | null {
  const s = [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();
  return s || null;
}

export interface SaleCheck {
  decision: CodeDecision;
  /** Person am Bändchen (für Texte), falls bekannt. */
  holder: { id: number; firstName: string | null; lastName: string | null } | null;
  owner: ChipOwnerKind;
  tickets: CodeTicket[];
}

/** Entscheidung für den Verkauf eines Tickets auf `code`. */
export async function decideSale(
  accountId: number,
  input: {
    code: string;
    personId: number | null;
    typedName?: { firstName?: string | null; lastName?: string | null };
    resolve?: "share" | "transfer" | null;
    now?: Date;
  },
): Promise<SaleCheck> {
  const [tickets, chip] = await Promise.all([ticketsWithCode(prisma, accountId, input.code), loadChip(prisma, accountId, input.code)]);
  const state = chipState(chip);
  const owner = state?.owner ?? deriveOwner(tickets);
  const { personId: holderId } = chipHolder(owner, state, tickets);
  const holder = holderId != null
    ? await prisma.riderProfile.findFirst({ where: { id: holderId, accountId }, select: { id: true, firstName: true, lastName: true } })
    : null;
  if (input.personId != null) {
    const person = await prisma.riderProfile.findFirst({ where: { id: input.personId, accountId }, select: { id: true } });
    if (!person) throw new RiderError("Diese Person gibt es nicht.", 404);
  }
  const decision = decideCodeUse({
    code: input.code,
    chip: state,
    tickets,
    personId: input.personId,
    typedName: input.typedName,
    chipPersonName: holder,
    resolve: input.resolve,
    now: input.now,
  });
  return { decision, holder, owner, tickets };
}

/** Codes am neuen Ticket je nach Entscheidung. */
export function codesForDecision(code: string, decision: CodeDecision): { rfidCode: string; qrCode: string; barcode: string | undefined } {
  // Barcode ist eindeutig: steht er schon an einem alten Ticket, bleibt er dort.
  if (decision.kind === "SHARE" && !decision.setBarcode) return { rfidCode: code, qrCode: code, barcode: undefined };
  return { rfidCode: code, qrCode: code, barcode: code };
}

/**
 * Nach dem Verkauf: Bändchen anlegen oder fortschreiben und den Verlauf
 * ergänzen. Fehler hier brechen den Verkauf nicht ab (Aufrufer fängt).
 */
export async function recordChipSale(
  accountId: number,
  input: { code: string; decision: CodeDecision; ticketId: number; owner: ChipOwnerKind; previousHolder: number | null; source?: string },
): Promise<void> {
  const { code, decision, ticketId } = input;
  const source = input.source ?? "KASSE";
  await prisma.$transaction(async (tx) => {
    let chip = await loadChip(tx, accountId, code);
    if (!chip) {
      try {
        chip = await tx.chip.create({
          data: { accountId, code, owner: input.owner, riderProfileId: input.owner === "BETRIEB" ? null : decision.personId },
          select: { id: true, code: true, owner: true, riderProfileId: true, blockedAt: true },
        });
      } catch (e) {
        if (!(typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002")) throw e;
        chip = await loadChip(tx, accountId, code);
        if (!chip) throw e;
      }
      await tx.chipEvent.create({
        data: { accountId, chipId: chip.id, kind: "ANGELEGT", ticketId, riderProfileId: chip.riderProfileId, source, note: input.owner },
      });
    } else if (decision.kind === "TRANSFER") {
      const next = decision.personId;
      await tx.chip.update({ where: { id: chip.id }, data: { riderProfileId: chip.owner === "BETRIEB" && next == null ? null : next } });
      await tx.chipEvent.create({
        data: {
          accountId,
          chipId: chip.id,
          kind: "UEBERNOMMEN",
          ticketId,
          riderProfileId: next,
          source,
          // Für „Rückgängig“: welche Tickets den Code abgegeben haben.
          note: JSON.stringify({ vorher: input.previousHolder, abgezogen: decision.stripTicketIds.filter((id) => id !== ticketId) }),
        },
      });
    } else if (decision.personId != null && chip.riderProfileId == null && chip.owner !== "BETRIEB") {
      // Bändchen ohne Person: ab jetzt gehört es der Person, für die verkauft wurde.
      await tx.chip.update({ where: { id: chip.id }, data: { riderProfileId: decision.personId } });
      await tx.chipEvent.create({
        data: { accountId, chipId: chip.id, kind: "PERSON", ticketId, riderProfileId: decision.personId, source },
      });
    }
    await tx.chipEvent.create({
      data: { accountId, chipId: chip.id, kind: "AUSGEGEBEN", ticketId, riderProfileId: decision.personId, source },
    });
  });
}

/** Tagesticket einer Person: in der App zählen (nur Services der Gamification). */
export async function countForPerson(accountId: number, ticketIds: number[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const config = await loadGamiConfig(tenantClient(accountId), accountId);
  if (!config.enabled || config.dayServiceIds.length === 0) return;
  const rows = await prisma.ticket.findMany({
    where: { accountId, id: { in: ticketIds }, subscriptionId: null, riderProfileId: { not: null }, gamificationOptOut: false, serviceId: { in: config.dayServiceIds } },
    select: { id: true },
  });
  if (rows.length > 0) await countLinked(accountId, rows.map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Kundenfenster

const VIEW_TICKET_SELECT = {
  ...CODE_TICKET_SELECT,
  name: true,
  ticketTypeName: true,
  serviceId: true,
  rfidCode: true,
  email: true,
  annyOrderId: true,
  extras: true,
  service: { select: { name: true } },
  subscription: { select: { name: true } },
} as const;

type ViewTicketRow = CodeTicket & {
  firstName: string | null;
  lastName: string | null;
  name: string;
  ticketTypeName: string | null;
  serviceId: number | null;
  rfidCode: string | null;
  email: string | null;
  annyOrderId: string | null;
  extras: unknown;
  service: { name: string } | null;
  subscription: { name: string } | null;
};

const HOUR_CACHE_MS = 10 * 60_000;
const hourCache = new Map<number, { at: number; rows: HourSales[] }>();

/** Verkäufe der Kasse im letzten Jahr je Service und Stunde (zwischengespeichert). */
async function hourSales(accountId: number): Promise<HourSales[]> {
  const hit = hourCache.get(accountId);
  if (hit && Date.now() - hit.at < HOUR_CACHE_MS) return hit.rows;
  const rows = await prisma.$queryRaw<Array<{ sid: number; h: number; n: number }>>`
    SELECT "serviceId" AS sid,
           EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')::int AS h,
           count(*)::int AS n
    FROM "Ticket"
    WHERE "accountId" = ${accountId}
      AND "subscriptionId" IS NULL AND "serviceId" IS NOT NULL
      AND source IS NULL AND "bulkBatchId" IS NULL
      AND "createdAt" >= now() - interval '365 days'
    GROUP BY 1, 2`;
  const out = rows.map((r) => ({ serviceId: Number(r.sid), hour: Number(r.h), count: Number(r.n) }));
  hourCache.set(accountId, { at: Date.now(), rows: out });
  return out;
}

function ticketLabel(t: ViewTicketRow): string {
  return t.ticketTypeName || t.service?.name || t.subscription?.name || t.name || "Ticket";
}

function historyState(t: ViewTicketRow, inUse: boolean, used: boolean, now: Date): HistoryState {
  if (t.status === "CANCELED" || t.status === "INVALID") return "storniert";
  if (t.status === "PAUSED") return "pausiert";
  if (t.subscriptionId != null) return inUse ? "läuft" : "abgelaufen";
  if (inUse) return used ? "aktiv" : berlinYmd(t.createdAt) === berlinYmd(now) ? "neu" : "aktiv";
  return used || t.status === "REDEEMED" ? "eingelöst" : "abgelaufen";
}

interface DeviceRow { id: number; countsAsStart: boolean; legacyStartsUntil: Date | null }

function isStartScan(devices: DeviceRow[], s: { deviceId: number | null; scanTime: Date }): boolean {
  if (s.deviceId == null) return false;
  const d = devices.find((x) => x.id === s.deviceId);
  if (!d) return false;
  return d.countsAsStart || (d.legacyStartsUntil != null && s.scanTime < d.legacyStartsUntil);
}

/** Code im Kundenfenster auflösen: gespeicherte Schreibweise über die Scan-Varianten. */
export async function resolveStoredCode(accountId: number, raw: string): Promise<string | null> {
  for (const c of buildScanCodeVariants(raw)) {
    const chip = await prisma.chip.findUnique({ where: { accountId_code: { accountId, code: c } }, select: { code: true } });
    if (chip) return chip.code;
    const t = await prisma.ticket.findFirst({
      where: { accountId, OR: [{ rfidCode: c }, { qrCode: c }, { barcode: c }] },
      select: { id: true },
    });
    if (t) return c;
  }
  return null;
}

/**
 * Kundenfenster zu einem Code. `code` ist die gespeicherte Schreibweise (oder
 * der rohe Code, wenn er unbekannt ist). `annyTicketId`: gescanntes
 * anny-Ticket (Buchung über anny), dann kommt die Buchung mit.
 */
export async function loadChipView(
  accountId: number,
  code: string | null,
  opts: { now?: Date; personId?: number | null; annyTicketId?: number | null } = {},
): Promise<ChipView> {
  const now = opts.now ?? new Date();
  const [codeTickets, chip] = code
    ? await Promise.all([
        prisma.ticket.findMany({
          where: { accountId, OR: [{ rfidCode: code }, { qrCode: code }, { barcode: code }] },
          select: VIEW_TICKET_SELECT,
          orderBy: { id: "desc" },
          take: 200,
        }) as Promise<ViewTicketRow[]>,
        loadChip(prisma, accountId, code),
      ])
    : [[] as ViewTicketRow[], null];
  const state = chipState(chip);
  const owner = state?.owner ?? deriveOwner(codeTickets);
  const holder = chipHolder(owner, state, codeTickets);
  const personId = opts.personId ?? holder.personId;

  const person = personId != null
    ? await prisma.riderProfile.findFirst({
        where: { id: personId, accountId },
        select: {
          id: true, firstName: true, lastName: true, birthDate: true, lastSeenAt: true,
          customer: { select: { id: true, email: true } },
        },
      })
    : null;

  const personTickets: ViewTicketRow[] = person
    ? ((await prisma.ticket.findMany({
        where: { accountId, riderProfileId: person.id },
        select: VIEW_TICKET_SELECT,
        orderBy: { id: "desc" },
        take: 200,
      })) as ViewTicketRow[])
    : [];

  // Leihbändchen ohne Person: frühere Gäste gehören nicht ins Fenster.
  const showCodeHistory = owner !== "BETRIEB" || person != null;
  const byId = new Map<number, ViewTicketRow>();
  for (const t of personTickets) byId.set(t.id, t);
  if (showCodeHistory) {
    for (const t of codeTickets) {
      // Tickets anderer Personen am selben Code nicht zeigen.
      if (person && t.riderProfileId != null && t.riderProfileId !== person.id) continue;
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
  }
  const all = [...byId.values()];
  const ids = all.map((t) => t.id);

  const yearStart = berlinYearStart(now);
  const [scans, devices, awards, lastScan] = await Promise.all([
    ids.length
      ? prisma.scan.findMany({
          where: { accountId, ticketId: { in: ids }, result: "GRANTED", scanTime: { gte: yearStart } },
          select: { ticketId: true, deviceId: true, scanTime: true },
          take: 10_000,
        })
      : Promise.resolve([]),
    prisma.device.findMany({
      where: { accountId, OR: [{ countsAsStart: true }, { legacyStartsUntil: { not: null } }] },
      select: { id: true, countsAsStart: true, legacyStartsUntil: true },
    }),
    person && ids.length ? prisma.milestoneAward.count({ where: { accountId, ticketId: { in: ids } } }) : Promise.resolve(null),
    ids.length
      ? prisma.scan.findFirst({
          where: { accountId, ticketId: { in: ids }, result: "GRANTED" },
          orderBy: { scanTime: "desc" },
          select: { scanTime: true },
        })
      : Promise.resolve(null),
  ]);
  const days = new Set<string>();
  const startsByTicket = new Map<number, number>();
  const usedTickets = new Set<number>();
  const today = berlinYmd(now);
  const checkedToday = new Set<number>();
  let starts = 0;
  for (const s of scans) {
    days.add(berlinYmd(s.scanTime));
    if (s.ticketId != null) {
      usedTickets.add(s.ticketId);
      if (berlinYmd(s.scanTime) === today) checkedToday.add(s.ticketId);
    }
    if (isStartScan(devices, s)) {
      starts++;
      if (s.ticketId != null) startsByTicket.set(s.ticketId, (startsByTicket.get(s.ticketId) ?? 0) + 1);
    }
  }
  // Ältere Scans (Vorjahre) machen ein Ticket auch „eingelöst“.
  const older = ids.filter((id) => !usedTickets.has(id));
  if (older.length) {
    const rows = await prisma.scan.groupBy({
      by: ["ticketId"],
      where: { accountId, ticketId: { in: older }, result: "GRANTED" },
      _count: { _all: true },
    });
    for (const r of rows) if (r.ticketId != null) usedTickets.add(r.ticketId);
  }

  const toView = (t: ViewTicketRow): ChipViewTicket => {
    const inUse = isTicketInUse(t, now);
    return {
      id: t.id,
      label: ticketLabel(t),
      at: (t.startDate ?? t.createdAt).toISOString(),
      createdAt: t.createdAt.toISOString(),
      endDate: t.endDate?.toISOString() ?? null,
      kind: t.subscriptionId != null ? "ABO" : "TICKET",
      source: t.source === "ANNY" ? "ANNY" : t.source == null ? "KASSE" : "ANDERE",
      state: historyState(t, inUse, usedTickets.has(t.id), now),
      starts: startsByTicket.get(t.id) ?? 0,
      serviceId: t.serviceId,
      subscriptionId: t.subscriptionId,
      inUse,
      checkedInToday: checkedToday.has(t.id) || (t.subscriptionId == null && t.status === "REDEEMED" && inUse),
      firstName: t.firstName,
      lastName: t.lastName,
      rfidCode: t.rfidCode,
      personal: person != null && t.riderProfileId === person.id,
    };
  };

  const sorted = all.sort((a, b) => (b.startDate ?? b.createdAt).getTime() - (a.startDate ?? a.createdAt).getTime() || b.id - a.id);
  const views = sorted.map(toView);
  const active = views.filter((v) => v.inUse);

  const services = await prisma.service.findMany({ where: { accountId }, select: { id: true } });
  const sellable = new Set(services.map((s) => s.id));
  let suggestion: Suggestion = suggestFromHistory(
    sorted.map((t) => ({ serviceId: t.serviceId, subscriptionId: t.subscriptionId, at: t.startDate ?? t.createdAt })),
    sellable,
  );
  if (suggestion.basis === "none" || !showCodeHistory) suggestion = suggestByHour(await hourSales(accountId), sellable, now);

  const noPerson = codeTickets.filter((t) => t.riderProfileId == null && t.subscriptionId == null);
  const latestNamed = codeTickets.find((t) => t.firstName || t.lastName);
  const lastGuestTicket = !showCodeHistory ? codeTickets[0] : null;

  let anny: AnnyOrderView | null = null;
  if (opts.annyTicketId != null) anny = await loadAnnyOrder(accountId, opts.annyTicketId, now);

  return {
    code,
    known: codeTickets.length > 0 || chip != null,
    chipId: chip?.id ?? null,
    owner,
    blocked: chip?.blockedAt != null,
    person: person
      ? {
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          age: ageAt(person.birthDate, now),
          inApp: person.lastSeenAt != null,
          customer: person.customer ? { id: person.customer.id, email: maskEmail(person.customer.email) } : null,
        }
      : null,
    ambiguous: holder.ambiguous.length > 0 && !person
      ? (await prisma.riderProfile.findMany({ where: { accountId, id: { in: holder.ambiguous } }, select: { id: true, firstName: true, lastName: true } }))
          .map((p) => ({ id: p.id, name: fullName(p) ?? `Person ${p.id}` }))
      : [],
    lastName: latestNamed ? { firstName: latestNamed.firstName, lastName: latestNamed.lastName } : null,
    openTickets: showCodeHistory ? noPerson.length : 0,
    stats: {
      year: Number(berlinYmd(now).slice(0, 4)),
      visits: showCodeHistory || person ? days.size : 0,
      starts: showCodeHistory || person ? starts : 0,
      awards,
      lastVisit: lastScan?.scanTime.toISOString() ?? null,
    },
    history: showCodeHistory || person ? views.slice(0, 8) : [],
    active,
    suggestion: {
      serviceId: suggestion.serviceId,
      count: suggestion.count,
      of: suggestion.of,
      lastAt: suggestion.lastAt?.toISOString() ?? null,
      frequent: suggestion.frequent,
      basis: suggestion.basis,
    },
    lastGuest: lastGuestTicket
      ? { label: ticketLabel(lastGuestTicket), at: (lastGuestTicket.startDate ?? lastGuestTicket.createdAt).toISOString(), inUse: isTicketInUse(lastGuestTicket, now) }
      : null,
    anny,
  };
}

// ---------------------------------------------------------------------------
// anny-Buchung an der Kasse

function paymentOpen(extras: unknown): boolean {
  return typeof extras === "object" && extras != null && "paymentOpen" in extras && Boolean((extras as { paymentOpen?: unknown }).paymentOpen);
}

/**
 * Gescanntes anny-Ticket: alle Tickets derselben Bestellung. Das erste Ticket
 * der Bestellung gehört dem Bucher; seine Person kommt über die E-Mail aus
 * anny in ein Kundenkonto (angelegt, wenn es fehlt). Es geht keine Mail raus.
 */
export async function loadAnnyOrder(accountId: number, ticketId: number, now: Date = new Date()): Promise<AnnyOrderView | null> {
  const scanned = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: { id: true, annyOrderId: true, source: true, subscriptionId: true },
  });
  if (!scanned || scanned.source !== "ANNY" || scanned.subscriptionId != null) return null;
  const tickets = (await prisma.ticket.findMany({
    where: scanned.annyOrderId ? { accountId, annyOrderId: scanned.annyOrderId, subscriptionId: null } : { id: scanned.id },
    select: VIEW_TICKET_SELECT,
    orderBy: { id: "asc" },
    take: 30,
  })) as ViewTicketRow[];
  // Nur Tickets desselben Tages wie das gescannte (eine Bestellung kann mehrere Tage haben).
  const scannedRow = tickets.find((t) => t.id === scanned.id)!;
  const day = berlinYmd(scannedRow.startDate ?? scannedRow.createdAt);
  const sameDay = tickets.filter((t) => berlinYmd(t.startDate ?? t.createdAt) === day);
  const booker = sameDay[0];
  const scans = await prisma.scan.findMany({
    where: { accountId, ticketId: { in: sameDay.map((t) => t.id) }, result: "GRANTED", scanTime: { gte: berlinYearStart(now) } },
    select: { ticketId: true, scanTime: true },
  });
  const today = berlinYmd(now);
  const checked = new Set(scans.filter((s) => berlinYmd(s.scanTime) === today).map((s) => s.ticketId));
  return {
    orderId: scanned.annyOrderId ?? String(scanned.id),
    label: ticketLabel(scannedRow),
    slot: scannedRow.slotStart && scannedRow.slotEnd ? `${scannedRow.slotStart} bis ${scannedRow.slotEnd} Uhr` : null,
    paymentOpen: sameDay.some((t) => paymentOpen(t.extras)),
    tickets: sameDay.map((t) => ({
      id: t.id,
      booker: t.id === booker.id,
      personId: t.riderProfileId,
      firstName: t.id === booker.id ? t.firstName : null,
      rfidCode: t.rfidCode,
      checkedIn: checked.has(t.id) || t.status === "REDEEMED",
      status: t.status,
    })),
  };
}

/**
 * Bucher eines anny-Tickets: Kundenkonto über die E-Mail, Person mit dem Namen
 * aus anny (vorhandene Person mit gleichem Namen bevorzugt). Hängt die Person
 * an das erste Ticket der Bestellung. Gibt die Person zurück (oder null ohne
 * E-Mail/Namen).
 */
export async function ensureAnnyBooker(accountId: number, ticketId: number): Promise<number | null> {
  const scanned = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId, source: "ANNY", subscriptionId: null },
    select: { id: true, annyOrderId: true, startDate: true, createdAt: true },
  });
  if (!scanned) return null;
  const order = await prisma.ticket.findMany({
    where: scanned.annyOrderId ? { accountId, annyOrderId: scanned.annyOrderId, subscriptionId: null } : { id: scanned.id },
    select: { id: true, riderProfileId: true, email: true, firstName: true, lastName: true, startDate: true, createdAt: true, gamificationOptOut: true },
    orderBy: { id: "asc" },
    take: 30,
  });
  const day = berlinYmd(scanned.startDate ?? scanned.createdAt);
  const booker = order.find((t) => berlinYmd(t.startDate ?? t.createdAt) === day);
  if (!booker) return null;
  if (booker.riderProfileId != null) return booker.riderProfileId;
  const email = cleanEmail(booker.email);
  if (!email || (!booker.firstName && !booker.lastName)) return null;
  const customerId = await ensureCustomer(accountId, { email, name: fullName(booker) });
  if (customerId == null) return null;
  const persons = await prisma.riderProfile.findMany({
    where: { accountId, customerId },
    select: { id: true, firstName: true, lastName: true, birthDate: true },
    orderBy: { id: "asc" },
  });
  const bookerName = fullName(booker)?.toLowerCase();
  let personId = persons.find((p) => fullName(p)?.toLowerCase() === bookerName)?.id ?? null;
  let created = false;
  if (personId == null) {
    const p = await prisma.riderProfile.create({
      data: { accountId, customerId, token: newRiderToken(), firstName: booker.firstName, lastName: booker.lastName },
      select: { id: true },
    });
    personId = p.id;
    created = true;
  }
  const linked = await prisma.ticket.updateMany({
    where: { accountId, id: booker.id, riderProfileId: null },
    data: { riderProfileId: personId },
  });
  if (created) await syncKontoFamily(accountId, customerId).catch(() => 0);
  if (linked.count > 0 && !booker.gamificationOptOut) await countForPerson(accountId, [booker.id]).catch(() => undefined);
  return personId;
}

// ---------------------------------------------------------------------------
// Kundenkonto an der Kasse anlegen

export interface KontoInput {
  code: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  birthDate: Date | null;
  owner: "KUNDE" | "BETRIEB";
  /** Tickets mit diesem Bändchen ohne Person übernehmen. */
  adopt: boolean;
}

function cleanName(v: string | null | undefined): string | null {
  const s = v?.trim().replace(/\s+/g, " ");
  return s ? s.slice(0, 80) : null;
}

/**
 * Konto zur E-Mail holen oder anlegen, Person darin finden (gleiche Daten)
 * oder anlegen, Bändchen an die Person hängen und auf Wunsch die bisherigen
 * Tickets des Bändchens übernehmen. Schickt keine Mail.
 */
export async function createKonto(accountId: number, input: KontoInput): Promise<{ personId: number; customerId: number; created: boolean; adopted: number }> {
  const email = cleanEmail(input.email);
  if (!email) throw new RiderError("Bitte eine gültige E-Mail-Adresse eintragen.");
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  if (!firstName && !lastName) throw new RiderError("Bitte Vor- oder Nachnamen eintragen.");
  if (input.birthDate && (isNaN(input.birthDate.getTime()) || input.birthDate.getTime() > Date.now())) {
    throw new RiderError("Das Geburtsdatum stimmt nicht.");
  }
  if (input.code) {
    const chip = await loadChip(prisma, accountId, input.code);
    if (chip?.blockedAt) throw new RiderError("Das Bändchen ist gesperrt.", 409);
    const tickets = await ticketsWithCode(prisma, accountId, input.code);
    const owner = chip?.owner ?? deriveOwner(tickets);
    if (owner === "MITARBEITER") throw new RiderError("Das ist ein Mitarbeiter-Bändchen.", 409);
  }

  const customerId = await ensureCustomer(accountId, { email, name: [firstName, lastName].filter(Boolean).join(" ") });
  if (customerId == null) throw new RiderError("Bitte eine gültige E-Mail-Adresse eintragen.");

  const key = personDataKey({ firstName, lastName, birthDate: input.birthDate });
  const persons = await prisma.riderProfile.findMany({
    where: { accountId, customerId },
    select: { id: true, firstName: true, lastName: true, birthDate: true },
    orderBy: { id: "asc" },
  });
  let person = persons.find((p) => personDataKey(p) === key)
    // Ohne Geburtsdatum: gleiche Person, wenn der Name passt.
    ?? (input.birthDate == null ? persons.find((p) => fullName(p)?.toLowerCase() === [firstName, lastName].filter(Boolean).join(" ").toLowerCase()) : undefined);
  let created = false;
  if (!person) {
    person = await prisma.riderProfile.create({
      data: { accountId, customerId, token: newRiderToken(), firstName, lastName, birthDate: input.birthDate },
      select: { id: true, firstName: true, lastName: true, birthDate: true },
    });
    created = true;
  } else if (input.birthDate && !person.birthDate) {
    await prisma.riderProfile.update({ where: { id: person.id }, data: { birthDate: input.birthDate } });
  }
  const personId = person.id;

  let adopted = 0;
  if (input.code) {
    const code = input.code;
    const adoptIds = await prisma.$transaction(async (tx) => {
      let chip = await loadChip(tx, accountId, code);
      const tickets = await ticketsWithCode(tx, accountId, code);
      const owner: ChipOwnerKind = input.owner;
      const prevOwner: ChipOwnerKind = chip?.owner ?? deriveOwner(tickets);
      if (!chip) {
        chip = await tx.chip.create({
          data: { accountId, code, owner, riderProfileId: personId },
          select: { id: true, code: true, owner: true, riderProfileId: true, blockedAt: true },
        });
        await tx.chipEvent.create({ data: { accountId, chipId: chip.id, kind: "ANGELEGT", riderProfileId: personId, source: "KASSE", note: owner } });
      } else {
        const prev = chip.riderProfileId;
        await tx.chip.update({ where: { id: chip.id }, data: { riderProfileId: personId, owner } });
        if (prev !== personId) {
          await tx.chipEvent.create({
            data: { accountId, chipId: chip.id, kind: prev == null ? "PERSON" : "UEBERNOMMEN", riderProfileId: personId, source: "KASSE", note: prev != null ? `vorher Person ${prev}` : null },
          });
        }
        if (chip.owner !== owner) {
          await tx.chipEvent.create({ data: { accountId, chipId: chip.id, kind: "EIGENTUM", riderProfileId: personId, source: "KASSE", note: owner } });
        }
      }
      if (!input.adopt) return [];
      // Leihbändchen: frühere Gäste gehören nicht zur Person.
      if (prevOwner === "BETRIEB") return [];
      const ids = tickets.filter((t) => t.riderProfileId == null && t.subscriptionId == null).map((t) => t.id);
      if (ids.length === 0) return [];
      await tx.ticket.updateMany({ where: { accountId, id: { in: ids }, riderProfileId: null }, data: { riderProfileId: personId } });
      await tx.chipEvent.create({
        data: { accountId, chipId: chip.id, kind: "UEBERNOMMEN", riderProfileId: personId, source: "KASSE", note: `${ids.length} Tickets übernommen` },
      });
      return ids;
    });
    adopted = adoptIds.length;
    if (adopted > 0) await countForPerson(accountId, adoptIds).catch((e) => console.warn("[chips] Zählen nach Übernahme", e));
  }
  if (created) await syncKontoFamily(accountId, customerId).catch(() => 0);
  return { personId, customerId, created, adopted };
}

/** Personen suchen (Kasse: „Kunde suchen“): Name oder E-Mail des Kontos. */
export async function searchPersons(accountId: number, q: string, now: Date = new Date()) {
  const term = q.trim().replace(/\s+/g, " ").slice(0, 60);
  if (term.length < 2) return [];
  const parts = term.split(" ");
  const where = term.includes("@")
    ? { accountId, OR: [{ email: { contains: term, mode: "insensitive" as const } }, { customer: { email: { contains: term, mode: "insensitive" as const } } }] }
    : {
        accountId,
        AND: parts.map((p) => ({
          OR: [
            { firstName: { contains: p, mode: "insensitive" as const } },
            { lastName: { contains: p, mode: "insensitive" as const } },
          ],
        })),
      };
  const rows = await prisma.riderProfile.findMany({
    where,
    select: {
      id: true, firstName: true, lastName: true, birthDate: true,
      customer: { select: { email: true } },
      _count: { select: { chips: true, tickets: true } },
    },
    orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: 8,
  });
  return rows.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    age: ageAt(p.birthDate, now),
    email: p.customer?.email ? maskEmail(p.customer.email) : null,
    chips: p._count.chips,
    tickets: p._count.tickets,
  }));
}

// ---------------------------------------------------------------------------
// Rückgängig

export const UNDO_MINUTES = 15;

function parseNote(note: string | null | undefined): { vorher?: unknown; abgezogen?: unknown } {
  if (!note) return {};
  try {
    const v = JSON.parse(note) as unknown;
    return typeof v === "object" && v != null ? (v as { vorher?: unknown; abgezogen?: unknown }) : {};
  } catch {
    return {};
  }
}
function parseStripped(note: string | null | undefined): number[] {
  const a = parseNote(note).abgezogen;
  return Array.isArray(a) ? a.filter((x): x is number => typeof x === "number" && Number.isInteger(x)) : [];
}
function parseHolder(note: string | null | undefined): number | null {
  const v = parseNote(note).vorher;
  return typeof v === "number" ? v : null;
}

/**
 * Gerade verkauftes Ticket wieder entfernen: nur Kassen-Tickets der letzten
 * Minuten ohne Scan, ohne anny-Buchung und ohne eingelösten Gutschein. Hat der
 * Verkauf das Bändchen erst an die Person gehängt, ist es danach wieder frei.
 */
export async function undoSale(accountId: number, ticketId: number, now: Date = new Date()): Promise<void> {
  const t = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: { id: true, createdAt: true, source: true, annyBookingId: true, rfidCode: true, riderProfileId: true, _count: { select: { scans: true } } },
  });
  if (!t) throw new RiderError("Ticket nicht gefunden.", 404);
  if (t.source != null || t.annyBookingId) throw new RiderError("Dieses Ticket kann hier nicht zurückgenommen werden.", 409);
  if (now.getTime() - t.createdAt.getTime() > UNDO_MINUTES * 60_000) {
    throw new RiderError(`Rückgängig geht nur in den ersten ${UNDO_MINUTES} Minuten.`, 409);
  }
  if (t._count.scans > 0) throw new RiderError("Das Ticket wurde schon gescannt.", 409);
  const voucher = await prisma.voucher.findFirst({ where: { accountId, redeemedTicketId: t.id }, select: { id: true } });
  if (voucher) throw new RiderError("Mit dem Ticket wurde ein Gutschein eingelöst.", 409);

  await prisma.$transaction(async (tx) => {
    if (t.rfidCode) {
      const chip = await loadChip(tx, accountId, t.rfidCode);
      if (chip) {
        const personEvent = await tx.chipEvent.findFirst({ where: { chipId: chip.id, ticketId: t.id, kind: "PERSON" }, select: { id: true } });
        if (personEvent && chip.riderProfileId === t.riderProfileId) {
          await tx.chip.update({ where: { id: chip.id }, data: { riderProfileId: null } });
        }
        // Bändchen war übergeben worden: die alten Tickets bekommen den Code zurück.
        const transfer = await tx.chipEvent.findFirst({ where: { chipId: chip.id, ticketId: t.id, kind: "UEBERNOMMEN" }, select: { note: true } });
        const stripped = parseStripped(transfer?.note);
        if (stripped.length > 0) {
          await tx.ticket.updateMany({ where: { accountId, id: { in: stripped }, rfidCode: null }, data: { rfidCode: chip.code } });
          await tx.ticket.updateMany({ where: { accountId, id: { in: stripped }, qrCode: null }, data: { qrCode: chip.code } });
          // Barcode ist eindeutig: erst nach dem Löschen des neuen Tickets wieder frei.
          await tx.ticket.update({ where: { id: t.id }, data: { barcode: null } });
          const taken = await tx.ticket.findFirst({ where: { barcode: chip.code }, select: { id: true } });
          if (!taken) await tx.ticket.update({ where: { id: Math.min(...stripped) }, data: { barcode: chip.code } }).catch(() => undefined);
          const prev = parseHolder(transfer?.note);
          await tx.chip.update({ where: { id: chip.id }, data: { riderProfileId: prev } });
        }
        await tx.chipEvent.create({ data: { accountId, chipId: chip.id, kind: "RUECKGAENGIG", ticketId: t.id, riderProfileId: t.riderProfileId, source: "KASSE" } });
      }
    }
    await tx.ticket.delete({ where: { id: t.id } });
  });
}
