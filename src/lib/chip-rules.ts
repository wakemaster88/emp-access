/**
 * Bändchen (Chip) am Kunden statt am Ticket: Regeln ohne Datenbank.
 *
 * Ein Code (RFID, QR, Barcode) steht weiter am Ticket (`Ticket.rfidCode`),
 * damit Drehkreuze und Lift unverändert lesen. Neu ist, wem das Bändchen
 * gehört und wer damit fährt (`Chip`, siehe prisma/schema.prisma). Verkauft
 * die Kasse ein neues Ticket auf ein Bändchen, behalten die alten Tickets
 * ihren Code; das neue Ticket bekommt ihn dazu („teilen“). Abgezogen wird
 * ein Code nur noch, wenn das Bändchen wirklich an jemand anderen geht.
 *
 * Darf auch im Browser laufen: hier nichts importieren, was Prisma lädt.
 */
import { isDurationExpired } from "./scan-candidate";
import { isDurationPastBerlinDay } from "./duration-ticket";
import { berlinYmd } from "./berlin-day";

export type ChipOwnerKind = "KUNDE" | "BETRIEB" | "MITARBEITER";

/** Ticket, an dem ein Code steht (Auszug). */
export interface CodeTicket {
  id: number;
  riderProfileId: number | null;
  subscriptionId: number | null;
  vereinId?: number | null;
  bulkBatchId: string | null;
  source: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  validityType: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: Date | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  barcode: string | null;
  createdAt: Date;
  firstName?: string | null;
  lastName?: string | null;
}

/** Gespeicherter Stand des Bändchens (`Chip`), falls es schon eine Zeile gibt. */
export interface ChipState {
  owner: ChipOwnerKind;
  riderProfileId: number | null;
  blockedAt: Date | null;
}

/**
 * Eigentum aus den Tickets ableiten, solange es noch keine `Chip`-Zeile gibt:
 * Mitarbeiter-Ticket (emp-control) = Mitarbeiter-Chip, erstes Ticket aus einer
 * Serien-Erstellung = Bändchen des Betriebs, sonst das Bändchen des Gastes.
 */
export function deriveOwner(tickets: Pick<CodeTicket, "source" | "bulkBatchId" | "createdAt" | "id">[]): ChipOwnerKind {
  if (tickets.some((t) => t.source === "EMP_CONTROL")) return "MITARBEITER";
  const first = [...tickets].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)[0];
  if (first?.bulkBatchId) return "BETRIEB";
  return "KUNDE";
}

/** Personen, die an Tickets mit diesem Code hängen (ohne Doppelte, aufsteigend). */
export function personsOnTickets(tickets: Pick<CodeTicket, "riderProfileId">[]): number[] {
  return [...new Set(tickets.map((t) => t.riderProfileId).filter((id): id is number => id != null))].sort((a, b) => a - b);
}

/** Wer fährt mit dem Bändchen? Erst die `Chip`-Zeile, sonst die einzige Person an den Tickets. */
export function chipPerson(chip: ChipState | null, tickets: Pick<CodeTicket, "riderProfileId">[]): { personId: number | null; ambiguous: number[] } {
  if (chip?.riderProfileId != null) return { personId: chip.riderProfileId, ambiguous: [] };
  const persons = personsOnTickets(tickets);
  if (persons.length === 1) return { personId: persons[0], ambiguous: [] };
  return { personId: null, ambiguous: persons.length > 1 ? persons : [] };
}

/**
 * Wer fährt mit dem Bändchen, je nach Eigentum: Leihbändchen des Betriebs
 * gehören nur dann jemandem, wenn die Kasse es ausdrücklich ausgegeben hat
 * (`Chip.riderProfileId`). Frühere Gäste an seinen Tickets zählen nicht.
 */
export function chipHolder(owner: ChipOwnerKind, chip: ChipState | null, tickets: Pick<CodeTicket, "riderProfileId">[]): { personId: number | null; ambiguous: number[] } {
  if (owner === "BETRIEB") return { personId: chip?.riderProfileId ?? null, ambiguous: [] };
  return chipPerson(chip, tickets);
}

/**
 * Ist das Ticket heute noch nutzbar (Status, Zeitraum, Stundenkarte nicht
 * abgelaufen und nicht von einem früheren Tag)?
 */
export function isTicketInUse(t: CodeTicket, now: Date = new Date()): boolean {
  if (t.status !== "VALID" && t.status !== "REDEEMED") return false;
  const today = berlinYmd(now);
  if (t.startDate && berlinYmd(t.startDate) > today) return false;
  if (t.endDate && berlinYmd(t.endDate) < today) return false;
  if (isDurationExpired(t, now)) return false;
  if (isDurationPastBerlinDay(t, now)) return false;
  // Einzelticket ohne Ende, schon an einem früheren Tag eingelöst: vorbei.
  if (t.subscriptionId == null && t.vereinId == null && !t.endDate && t.validityType !== "DURATION" && t.status === "REDEEMED" && t.startDate && berlinYmd(t.startDate) < today) return false;
  // Stundenkarte ohne Datum und ohne Scan: gilt nur am Verkaufstag.
  if (t.validityType === "DURATION" && !t.startDate && !t.firstScanAt && berlinYmd(t.createdAt) !== today) return false;
  return true;
}

function normName(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

/** Kann der eingetippte Name zur Person des Bändchens gehören? Fehlt einer, ja. */
export function namesMatch(
  typed: { firstName?: string | null; lastName?: string | null },
  person: { firstName: string | null; lastName: string | null },
): boolean {
  const tf = normName(typed.firstName);
  const tl = normName(typed.lastName);
  const pf = normName(person.firstName);
  const pl = normName(person.lastName);
  if (tf && pf && tf !== pf) return false;
  if (tl && pl && tl !== pl) return false;
  return true;
}

export type ConflictReason = "OTHER_PERSON" | "LEIH_IN_USE" | "STAFF" | "BLOCKED" | "AMBIGUOUS";

export type CodeDecision =
  /** Code ist neu: wie bisher an Barcode, QR und RFID des neuen Tickets. */
  | { kind: "FREE"; personId: number | null }
  /** Alte Tickets behalten den Code, das neue bekommt ihn dazu. */
  | { kind: "SHARE"; personId: number | null; setBarcode: boolean }
  /** Code wandert: alte Tickets verlieren ihn (Bändchen geht an jemand anderen). */
  | { kind: "TRANSFER"; personId: number | null; stripTicketIds: number[] }
  | { kind: "CONFLICT"; reason: ConflictReason; ticketIds: number[]; personId: number | null };

export interface DecideInput {
  code: string;
  chip: ChipState | null;
  tickets: CodeTicket[];
  /** Person, für die verkauft wird (Kundenfenster); null = keine gewählt. */
  personId: number | null;
  /** Eingetippter Name im Formular (alter Weg ohne Kundenfenster). */
  typedName?: { firstName?: string | null; lastName?: string | null };
  /** Name der Person am Bändchen, für den Abgleich mit `typedName`. */
  chipPersonName?: { firstName: string | null; lastName: string | null } | null;
  /** Kasse hat bestätigt: Code teilen oder Bändchen übergeben. */
  resolve?: "share" | "transfer" | null;
  now?: Date;
}

/**
 * Was passiert mit dem Code beim Verkauf eines neuen Tickets?
 *
 * - Neuer Code: FREE.
 * - Bändchen derselben Person (oder ohne Person): SHARE, das neue Ticket
 *   zählt auf die Person des Bändchens. Ein laufendes Abo behält so sein
 *   Bändchen.
 * - Bändchen einer anderen Person, Mitarbeiter-Chip, Leihbändchen mit einem
 *   heute noch gültigen Ticket eines anderen Gastes, mehrere Personen am
 *   Code: CONFLICT. Die Kasse entscheidet (resolve „share“ oder „transfer“).
 * - Gesperrtes Bändchen: immer CONFLICT.
 */
export function decideCodeUse(input: DecideInput): CodeDecision {
  const now = input.now ?? new Date();
  const { chip, tickets } = input;
  const ids = tickets.map((t) => t.id);
  const barcodeTaken = tickets.some((t) => t.barcode === input.code);

  if (chip?.blockedAt) return { kind: "CONFLICT", reason: "BLOCKED", ticketIds: ids, personId: input.personId };
  if (tickets.length === 0 && !chip) return { kind: "FREE", personId: input.personId };

  const owner = chip?.owner ?? deriveOwner(tickets);
  const { personId: holder, ambiguous } = chipHolder(owner, chip, tickets);
  const target = input.personId ?? (holder != null && (!input.typedName || !input.chipPersonName || namesMatch(input.typedName, input.chipPersonName)) ? holder : null);

  if (input.resolve === "transfer") {
    return { kind: "TRANSFER", personId: input.personId, stripTicketIds: ids };
  }
  const share: CodeDecision = { kind: "SHARE", personId: target, setBarcode: !barcodeTaken };
  if (input.resolve === "share") return share;

  if (owner === "MITARBEITER") return { kind: "CONFLICT", reason: "STAFF", ticketIds: ids, personId: input.personId };

  if (ambiguous.length > 0 && (input.personId == null || !ambiguous.includes(input.personId))) {
    return { kind: "CONFLICT", reason: "AMBIGUOUS", ticketIds: ids, personId: input.personId };
  }
  if (holder != null) {
    if (input.personId != null && input.personId !== holder) {
      return { kind: "CONFLICT", reason: "OTHER_PERSON", ticketIds: ids, personId: input.personId };
    }
    if (input.personId == null && target == null) {
      // Eingetippter Name passt nicht zur Person des Bändchens.
      return { kind: "CONFLICT", reason: "OTHER_PERSON", ticketIds: ids, personId: null };
    }
    return share;
  }

  // Bändchen ohne Person.
  if (owner === "BETRIEB") {
    const inUse = tickets.filter((t) => isTicketInUse(t, now)).map((t) => t.id);
    if (inUse.length > 0) return { kind: "CONFLICT", reason: "LEIH_IN_USE", ticketIds: inUse, personId: input.personId };
  }
  return share;
}

/** Text für die Kasse zu einem Konflikt (deutsch, Du-Form). */
export function conflictText(reason: ConflictReason, holderName: string | null): string {
  const who = holderName || "einer anderen Person";
  switch (reason) {
    case "OTHER_PERSON":
      return `Das Bändchen gehört ${who}. Ein Ticket für jemand anderen bekommt ein eigenes Bändchen.`;
    case "LEIH_IN_USE":
      return "Das Leihbändchen hat heute noch ein gültiges Ticket eines anderen Gastes.";
    case "STAFF":
      return "Das ist ein Mitarbeiter-Bändchen.";
    case "BLOCKED":
      return "Das Bändchen ist gesperrt.";
    case "AMBIGUOUS":
      return "Das Bändchen hängt an Tickets verschiedener Personen.";
  }
}

// ---------------------------------------------------------------------------
// Vorschlag aus der Historie

export interface HistoryPurchase {
  serviceId: number | null;
  subscriptionId: number | null;
  at: Date;
}

export interface Suggestion {
  /** Service, der vorgeschlagen wird; null = keiner. */
  serviceId: number | null;
  /** So oft in den betrachteten Besuchen gekauft. */
  count: number;
  /** So viele Besuche wurden betrachtet. */
  of: number;
  lastAt: Date | null;
  /** Weitere Services aus der Historie, häufigste zuerst (ohne den Vorschlag). */
  frequent: Array<{ serviceId: number; count: number }>;
  /** Woher der Vorschlag kommt. */
  basis: "history" | "hour" | "none";
}

/** So viele Käufe zählen für den Vorschlag. */
export const SUGGEST_LAST = 8;

/**
 * Häufigster Service der letzten Käufe (ohne Abos), bei Gleichstand der
 * zuletzt gekaufte. Nur Services, die die Kasse verkaufen kann.
 */
export function suggestFromHistory(history: HistoryPurchase[], sellable: Set<number>, last: number = SUGGEST_LAST): Suggestion {
  const rows = history
    .filter((h) => h.subscriptionId == null && h.serviceId != null && sellable.has(h.serviceId))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, last);
  const byService = new Map<number, { count: number; lastAt: Date }>();
  for (const r of rows) {
    const cur = byService.get(r.serviceId!);
    if (cur) cur.count++;
    else byService.set(r.serviceId!, { count: 1, lastAt: r.at });
  }
  const ranked = [...byService.entries()].sort((a, b) => b[1].count - a[1].count || b[1].lastAt.getTime() - a[1].lastAt.getTime());
  if (ranked.length === 0) return { serviceId: null, count: 0, of: 0, lastAt: null, frequent: [], basis: "none" };
  const [first, ...rest] = ranked;
  return {
    serviceId: first[0],
    count: first[1].count,
    of: rows.length,
    lastAt: first[1].lastAt,
    frequent: rest.map(([serviceId, v]) => ({ serviceId, count: v.count })),
    basis: "history",
  };
}

/** Stunde in Berlin (0–23). */
export function berlinHourOf(d: Date): number {
  return Number(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false })) % 24;
}

/** Verkäufe der Kasse je Service und Stunde (Berlin). */
export interface HourSales {
  serviceId: number;
  hour: number;
  count: number;
}

/**
 * Vorschlag nach Uhrzeit (Leihbändchen, unbekanntes Bändchen): der Service,
 * der an der Kasse um diese Uhrzeit (± 1 Stunde) am häufigsten verkauft wurde.
 * Ohne Verkäufe in dem Fenster zählt der ganze Tag.
 */
export function suggestByHour(sales: HourSales[], sellable: Set<number>, now: Date = new Date()): Suggestion {
  const h = berlinHourOf(now);
  const usable = sales.filter((s) => sellable.has(s.serviceId) && s.count > 0);
  const near = usable.filter((s) => {
    const diff = Math.abs(s.hour - h);
    return Math.min(diff, 24 - diff) <= 1;
  });
  const pool = near.length > 0 ? near : usable;
  const counts = new Map<number, number>();
  for (const s of pool) counts.set(s.serviceId, (counts.get(s.serviceId) ?? 0) + s.count);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (ranked.length === 0) return { serviceId: null, count: 0, of: 0, lastAt: null, frequent: [], basis: "none" };
  return {
    serviceId: ranked[0][0],
    count: ranked[0][1],
    of: pool.reduce((n, s) => n + s.count, 0),
    lastAt: null,
    frequent: ranked.slice(1, 4).map(([serviceId, count]) => ({ serviceId, count })),
    basis: "hour",
  };
}

// ---------------------------------------------------------------------------
// Anzeige

/** Alter in Jahren am Tag `at`; null ohne Geburtsdatum. */
export function ageAt(birthDate: Date | string | null | undefined, at: Date = new Date()): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  const [y, m, d] = berlinYmd(at).split("-").map(Number);
  const [by, bm, bd] = b.toISOString().slice(0, 10).split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** Initialen für den Kreis im Kundenfenster. */
export function initials(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const a = (firstName ?? "").trim()[0] ?? "";
  const b = (lastName ?? "").trim()[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

// ---------------------------------------------------------------------------
// Kundenfenster an der Kasse (Antwort von POST …/scan, Feld `customer`)

export type HistoryState = "neu" | "aktiv" | "läuft" | "eingelöst" | "abgelaufen" | "storniert" | "pausiert";

export interface ChipViewTicket {
  id: number;
  label: string;
  /** Gültig ab bzw. gekauft (ISO). */
  at: string;
  createdAt: string;
  endDate: string | null;
  kind: "ABO" | "TICKET";
  source: "ANNY" | "KASSE" | "ANDERE";
  state: HistoryState;
  starts: number;
  serviceId: number | null;
  subscriptionId: number | null;
  /** Heute nutzbar. */
  inUse: boolean;
  /** Abo/Ticket heute schon eingecheckt (Scan heute). */
  checkedInToday: boolean;
  firstName: string | null;
  lastName: string | null;
  rfidCode: string | null;
  /** Ticket hängt an der Person, nicht nur am Bändchen. */
  personal: boolean;
}

export interface ChipViewSuggestion {
  serviceId: number | null;
  count: number;
  of: number;
  lastAt: string | null;
  frequent: Array<{ serviceId: number; count: number }>;
  basis: "history" | "hour" | "none";
}

export interface ChipViewPerson {
  id: number;
  firstName: string | null;
  lastName: string | null;
  age: number | null;
  /** Hat die App schon geöffnet. */
  inApp: boolean;
  customer: { id: number; email: string } | null;
}

export interface AnnyOrderView {
  orderId: string;
  label: string;
  slot: string | null;
  paymentOpen: boolean;
  tickets: Array<{
    id: number;
    booker: boolean;
    personId: number | null;
    firstName: string | null;
    rfidCode: string | null;
    checkedIn: boolean;
    status: string;
  }>;
}

export interface ChipView {
  /** Gespeicherte Schreibweise des Codes (beim Verkauf genau so mitschicken); null = ohne Bändchen. */
  code: string | null;
  known: boolean;
  chipId: number | null;
  owner: ChipOwnerKind;
  blocked: boolean;
  person: ChipViewPerson | null;
  /** Mehrere Personen am Code (Altbestand). */
  ambiguous: Array<{ id: number; name: string }>;
  /** Name am letzten Ticket (Stammgast ohne Konto). */
  lastName: { firstName: string | null; lastName: string | null } | null;
  /** Tickets mit diesem Code ohne Person (für „Besuche übernehmen“). */
  openTickets: number;
  stats: { year: number; visits: number; starts: number; awards: number | null; lastVisit: string | null };
  history: ChipViewTicket[];
  active: ChipViewTicket[];
  suggestion: ChipViewSuggestion;
  /** Leihbändchen: das letzte Ticket (ohne Namen). */
  lastGuest: { label: string; at: string; inUse: boolean } | null;
  anny: AnnyOrderView | null;
}
