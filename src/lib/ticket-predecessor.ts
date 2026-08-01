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

import type { Prisma, PrismaClient } from "@prisma/client";

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
};

type TicketDelegate = Pick<PrismaClient["ticket"], "findMany">;

/**
 * Vergleichsform eines Namens: Kleinbuchstaben, nur Buchstaben und Ziffern.
 * Damit matchen "Dr. Ratschow", "Dr.-Ratschow" und "dr ratschow" aufeinander.
 */
function normalizeName(value: string | null | undefined): string {
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
 * Sucht das juengste Ticket derselben Person, das eine Karte (oder ein Foto)
 * traegt. Zuerst per E-Mail, sonst per normalisiertem Vor- und Nachnamen.
 * Gibt `null` zurueck, wenn nichts Eindeutiges gefunden wurde.
 */
export async function findPredecessorTicket(
  ticketDb: TicketDelegate,
  accountId: number,
  lookup: PredecessorLookup,
): Promise<PredecessorMatch | null> {
  const email = lookup.email?.trim().toLowerCase() || null;
  const firstNorm = normalizeName(lookup.firstName);
  const lastNorm = normalizeName(lookup.lastName);

  const select = {
    id: true,
    rfidCode: true,
    profileImage: true,
    firstName: true,
    lastName: true,
    updatedAt: true,
  } satisfies Prisma.TicketSelect;

  const baseWhere = {
    accountId,
    OR: [{ rfidCode: { not: null } }, { profileImage: { not: null } }],
    ...(lookup.excludeTicketId != null
      ? { id: { not: lookup.excludeTicketId } }
      : {}),
  };

  if (email) {
    const byEmail = await ticketDb.findMany({
      where: { ...baseWhere, email: { equals: email, mode: "insensitive" } },
      select,
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    const best = pickBest(byEmail);
    if (best) {
      return {
        ticketId: best.id,
        rfidCode: best.rfidCode,
        profileImage: best.profileImage,
        matchedBy: "email",
      };
    }
  }

  // Namensweg: Vor- und Nachname muessen beide vorliegen, sonst ist die
  // Zuordnung zu unsicher (z. B. Sammel-/Firmentickets ohne Personennamen).
  if (!firstNorm || !lastNorm) return null;

  const anchor = longestToken(lookup.lastName);
  if (!anchor) return null;

  const byName = await ticketDb.findMany({
    where: {
      ...baseWhere,
      lastName: { contains: anchor, mode: "insensitive" },
    },
    select,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const exact = byName.filter(
    (t) =>
      normalizeName(t.firstName) === firstNorm &&
      normalizeName(t.lastName) === lastNorm,
  );
  const best = pickBest(exact);
  if (!best) return null;

  return {
    ticketId: best.id,
    rfidCode: best.rfidCode,
    profileImage: best.profileImage,
    matchedBy: "name",
  };
}
