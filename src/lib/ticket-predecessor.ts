// Vorgaenger-Ticket einer Person finden, um Karte (rfidCode) und Foto beim
// Abo-Wechsel mitzunehmen.
//
// Hintergrund: Beim Verlaengern/Neuanlegen eines Abos entsteht ein NEUES
// Ticket. Die physische Karte haengt aber weiter am alten Ticket. Sobald das
// alte Ticket ablaeuft (INVALID), findet der Scanner ueber die Karte nur noch
// das ungueltige Ticket und weist ab ("status_invalid") - obwohl ein gueltiges
// Abo existiert.
//
// Die Zuordnung ueber die ANNY-Kundennummer allein reicht nicht:
//   - ANNY vergibt bei Neuabschluss teils eine neue customer id fuer dieselbe
//     Person (uuid `anny-sub:<customerId>:<planId>`).
//   - Karten aus dem Reepay-Altbestand haengen an Tickets mit voellig anderem
//     uuid-Namensraum (`reepay:sub-XXXX`) und ohne E-Mail.
// Deshalb wird zusaetzlich ueber E-Mail und normalisierten Namen gesucht.
//
// Familienkonten: anny fuehrt ein Konto je E-Mail. Kauft ein Elternteil ein
// Kids-Abo ueber sein Konto, tragen beide Abos dieselbe Adresse und denselben
// Namen. Ohne Vorsicht erbte das Kinder-Abo Karte und Foto des Elternteils.
// Deshalb gilt (`choosePredecessor`):
//   - Laeuft unter der Adresse (bzw. dem Namen) ein Abo einer ANDEREN Art,
//     gehoert es vermutlich einer anderen Person. Dann kommen nur beendete
//     Tickets derselben Abo-Art als Vorgaenger in Frage.
//   - Tragen die verbleibenden Kandidaten verschiedene Karten auf Tickets, die
//     gleichzeitig liefen, sind es mehrere Personen: nichts erben, auch nicht
//     ueber den Namen. Die Kasse vergibt die Karte dann beim naechsten Besuch.
//     Folgen die Karten aufeinander (Ersatzkarte), gilt die neueste.

import type { Prisma, PrismaClient } from "@prisma/client";
import { canBeSamePerson } from "./abo-person";
import { ticketEmailWhere, ticketIdsByEmail } from "./ticket-email";

export type PredecessorMatch = {
  ticketId: number;
  rfidCode: string | null;
  profileImage: string | null;
  /** Wodurch der Treffer zustande kam - fuer Logs und UI-Hinweise. */
  matchedBy: "email" | "name";
};

export type PredecessorLookup = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  /** Dieses Ticket nicht als eigenen Vorgaenger zurueckgeben. */
  excludeTicketId?: number | null;
  /**
   * Abo-Art des neuen Tickets. Gesetzt, gelten laufende Abos einer anderen
   * Art unter derselben Adresse als andere Person (Familienkonto).
   */
  subscriptionId?: number | null;
};

/** Ein moegliches Vorgaenger-Ticket, wie es die Suche liefert. */
export type PredecessorCandidate = {
  id: number;
  rfidCode: string | null;
  profileImage: string | null;
  updatedAt: Date;
  subscriptionId: number | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
};

/**
 * Ergebnis der Auswahl. `none`: nichts Passendes, der naechste Suchweg darf
 * ran. `ambiguous`: mehrere Personen moeglich, es wird gar nichts vererbt.
 */
export type PredecessorDecision =
  | { kind: "match"; ticket: PredecessorCandidate }
  | { kind: "none" }
  | { kind: "ambiguous"; reason: "family" | "cards" };

export type PredecessorResult = {
  match: PredecessorMatch | null;
  /** Gesetzt, wenn bewusst nichts vererbt wird (mehrere Personen moeglich). */
  ambiguous: "family" | "cards" | null;
};

type TicketDelegate = Pick<PrismaClient["ticket"], "findMany">;

const RUNNING_STATUS = new Set(["VALID", "PAUSED", "REDEEMED"]);

/** Ticket ist gueltig, pausiert oder eingeloest und noch nicht abgelaufen. */
export function isRunningTicket(t: { status: string; endDate: Date | null }, now: Date = new Date()): boolean {
  return RUNNING_STATUS.has(t.status) && (t.endDate == null || t.endDate.getTime() > now.getTime());
}

/**
 * Vergleichsform eines Namens: Kleinbuchstaben, nur Buchstaben und Ziffern.
 * Damit matchen "Dr. Ratschow", "Dr.-Ratschow" und "dr ratschow" aufeinander.
 */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Laengstes Buchstaben-Token eines Namens - dient als Suchanker fuer die
 * DB-Query, weil Postgres hier nicht normalisiert vergleichen kann.
 * "Dr.-Ratschow" -> "ratschow"
 */
function longestToken(value: string | null | undefined): string | null {
  const tokens = (value ?? "")
    .split(/[^A-Za-zÀ-ÿ0-9]+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  return tokens.sort((a, b) => b.length - a.length)[0];
}

/** Neueste zuerst, Tickets mit Karte vor Tickets ohne. */
function pickBest<T extends { rfidCode: string | null; updatedAt: Date }>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (!!a.rfidCode !== !!b.rfidCode) return a.rfidCode ? -1 : 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0];
}

/**
 * Vorgaenger aus den Tickets EINER Person waehlen (alle Tickets einer Adresse
 * bzw. eines Namens). Siehe Kopfkommentar zu Familienkonten.
 */
export function choosePredecessor(
  candidates: PredecessorCandidate[],
  subscriptionId: number | null | undefined,
  now: Date = new Date(),
): PredecessorDecision {
  let pool = candidates.filter((t) => t.rfidCode || t.profileImage);
  if (pool.length === 0) return { kind: "none" };

  if (subscriptionId != null) {
    const otherRunning = candidates.some(
      (t) => t.subscriptionId != null && t.subscriptionId !== subscriptionId && isRunningTicket(t, now),
    );
    if (otherRunning) {
      pool = pool.filter((t) => t.subscriptionId === subscriptionId && !isRunningTicket(t, now));
      if (pool.length === 0) return { kind: "ambiguous", reason: "family" };
    }
  }

  // Verschiedene Karten zur selben Zeit: zwei Personen.
  const withCard = pool.filter((t) => t.rfidCode);
  for (let i = 0; i < withCard.length; i++) {
    for (let j = i + 1; j < withCard.length; j++) {
      const a = withCard[i], b = withCard[j];
      if (a.rfidCode !== b.rfidCode && !canBeSamePerson(a, b)) return { kind: "ambiguous", reason: "cards" };
    }
  }

  const best = pickBest(pool);
  return best ? { kind: "match", ticket: best } : { kind: "none" };
}

const CANDIDATE_SELECT = {
  id: true,
  rfidCode: true,
  profileImage: true,
  firstName: true,
  lastName: true,
  updatedAt: true,
  subscriptionId: true,
  status: true,
  startDate: true,
  endDate: true,
} satisfies Prisma.TicketSelect;

function toMatch(t: PredecessorCandidate, matchedBy: "email" | "name"): PredecessorMatch {
  return { ticketId: t.id, rfidCode: t.rfidCode, profileImage: t.profileImage, matchedBy };
}

/**
 * Sucht das juengste Ticket derselben Person, das eine Karte (oder ein Foto)
 * traegt. Zuerst per E-Mail, sonst per normalisiertem Vor- und Nachnamen.
 * Sagt ausserdem, ob bewusst nichts vererbt wird (Familienkonto, mehrere
 * Karten).
 */
export async function findPredecessor(
  ticketDb: TicketDelegate,
  accountId: number,
  lookup: PredecessorLookup,
  now: Date = new Date(),
): Promise<PredecessorResult> {
  const email = lookup.email?.trim().toLowerCase() || null;
  const firstNorm = normalizeName(lookup.firstName);
  const lastNorm = normalizeName(lookup.lastName);

  // Tickets mit Karte oder Foto (moegliche Vorgaenger) und alle Abos (laufende
  // Abos anderer Art verraten ein Familienkonto).
  const baseWhere = {
    accountId,
    OR: [
      { rfidCode: { not: null } },
      { profileImage: { not: null } },
      { subscriptionId: { not: null } },
    ],
    ...(lookup.excludeTicketId != null
      ? { id: { not: lookup.excludeTicketId } }
      : {}),
  };

  if (email) {
    // Tickets der Adresse über den Index (lib/ticket-email), ohne das eigene.
    const emailIds = (await ticketIdsByEmail(accountId, email)).filter((id) => id !== lookup.excludeTicketId);
    const byEmail = emailIds.length === 0 ? [] : await ticketDb.findMany({
      where: { ...baseWhere, ...ticketEmailWhere(emailIds, email) },
      select: CANDIDATE_SELECT,
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    const decision = choosePredecessor(byEmail, lookup.subscriptionId, now);
    if (decision.kind === "match") return { match: toMatch(decision.ticket, "email"), ambiguous: null };
    if (decision.kind === "ambiguous") return { match: null, ambiguous: decision.reason };
  }

  // Namensweg: Vor- und Nachname muessen beide vorliegen, sonst ist die
  // Zuordnung zu unsicher (z. B. Sammel-/Firmentickets ohne Personennamen).
  if (!firstNorm || !lastNorm) return { match: null, ambiguous: null };

  const anchor = longestToken(lookup.lastName);
  if (!anchor) return { match: null, ambiguous: null };

  const byName = await ticketDb.findMany({
    where: {
      ...baseWhere,
      lastName: { contains: anchor, mode: "insensitive" },
    },
    select: CANDIDATE_SELECT,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const exact = byName.filter(
    (t) =>
      normalizeName(t.firstName) === firstNorm &&
      normalizeName(t.lastName) === lastNorm,
  );
  const decision = choosePredecessor(exact, lookup.subscriptionId, now);
  if (decision.kind === "match") return { match: toMatch(decision.ticket, "name"), ambiguous: null };
  return { match: null, ambiguous: decision.kind === "ambiguous" ? decision.reason : null };
}

/** Wie `findPredecessor`, nur der Treffer (oder null). */
export async function findPredecessorTicket(
  ticketDb: TicketDelegate,
  accountId: number,
  lookup: PredecessorLookup,
): Promise<PredecessorMatch | null> {
  return (await findPredecessor(ticketDb, accountId, lookup)).match;
}
