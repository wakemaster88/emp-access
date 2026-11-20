/**
 * Laufende Abos ohne E-Mail-Adresse (Abos › „Abos ohne E-Mail“).
 *
 * Jedes Abo hängt an einer Adresse (siehe lib/abo-email). Abos aus der Zeit
 * davor (Reepay-Import, manuell angelegt) haben teils keine. Die Liste zeigt
 * sie mit einem Vorschlag, wenn andere Tickets derselben Person genau eine
 * Adresse tragen. Eingetragen wird erst, wenn jemand den Vorschlag bestätigt.
 */
import type { PrismaClient, TicketStatus } from "@prisma/client";
import { normalizeName } from "./ticket-predecessor";

export type AboSource = "reepay" | "anny" | "manual";

export interface AboWithoutEmailRow {
  id: number;
  person: string;
  aboName: string | null;
  source: AboSource;
  status: TicketStatus;
  /** Ende der Laufzeit, ISO; null = offen. */
  endDate: string | null;
  /** Adresse anderer Tickets derselben Person, wenn es genau eine gibt. */
  suggestion: string | null;
}

interface PersonFields {
  name: string;
  firstName: string | null;
  lastName: string | null;
}

/** Herkunft eines Abos an der uuid: `reepay:sub-…`, `anny-sub:…`, sonst manuell. */
export function aboSource(uuid: string | null | undefined): AboSource {
  if (uuid?.startsWith("reepay:")) return "reepay";
  if (uuid?.startsWith("anny")) return "anny";
  return "manual";
}

export function personLabel(t: PersonFields): string {
  return [t.firstName, t.lastName].filter((v) => v?.trim()).join(" ").trim() || t.name;
}

/** Vergleichsform der Person: Vor- und Nachname, sonst der Ticketname. */
export function personKey(t: PersonFields): string {
  const first = normalizeName(t.firstName);
  const last = normalizeName(t.lastName);
  if (first && last) return `${first}|${last}`;
  return normalizeName(t.name);
}

/**
 * Vorschlag je Person: die eine Adresse, die andere Tickets mit demselben
 * Namen tragen. Bei mehreren Adressen gibt es keinen Vorschlag, denn dann ist
 * unklar, welche passt (etwa Eltern und Kind mit gleichem Namen).
 */
export function suggestEmails(
  candidates: Array<PersonFields & { email: string | null }>,
): Map<string, string> {
  const byPerson = new Map<string, Set<string>>();
  for (const c of candidates) {
    const email = c.email?.trim().toLowerCase();
    const key = personKey(c);
    if (!email || !key) continue;
    const set = byPerson.get(key) ?? new Set<string>();
    set.add(email);
    byPerson.set(key, set);
  }
  const out = new Map<string, string>();
  for (const [key, emails] of byPerson) {
    if (emails.size === 1) out.set(key, [...emails][0]);
  }
  return out;
}

const MAX_ROWS = 300;

export async function loadAbosWithoutEmail(
  db: PrismaClient,
  accountId: number,
  now: Date = new Date(),
): Promise<AboWithoutEmailRow[]> {
  const abos = await db.ticket.findMany({
    where: {
      accountId,
      subscriptionId: { not: null },
      status: { in: ["VALID", "REDEEMED", "PAUSED"] },
      OR: [{ endDate: null }, { endDate: { gt: now } }],
      AND: [{ OR: [{ email: null }, { email: "" }] }],
    },
    select: {
      id: true,
      uuid: true,
      name: true,
      firstName: true,
      lastName: true,
      status: true,
      endDate: true,
      subscription: { select: { name: true } },
    },
    orderBy: [{ endDate: "asc" }, { name: "asc" }],
    take: MAX_ROWS,
  });
  if (abos.length === 0) return [];

  // Kandidaten über den Nachnamen holen; verglichen wird danach normalisiert.
  // (Prisma 7: `in` mit `mode: "insensitive"` findet nichts, daher einzeln.)
  const lastNames = [...new Set(abos.map((a) => a.lastName?.trim()).filter((v): v is string => !!v))];
  const names = [...new Set(abos.filter((a) => !a.lastName?.trim()).map((a) => a.name.trim()).filter(Boolean))];
  const nameFilters = [
    ...lastNames.map((v) => ({ lastName: { equals: v, mode: "insensitive" as const } })),
    ...names.map((v) => ({ name: { equals: v, mode: "insensitive" as const } })),
  ];
  const candidates = nameFilters.length === 0
    ? []
    : await db.ticket.findMany({
      where: { accountId, email: { not: null }, NOT: { email: "" }, OR: nameFilters },
      select: { name: true, firstName: true, lastName: true, email: true },
      take: 5000,
    });
  const suggestions = suggestEmails(candidates);

  return abos.map((a) => ({
    id: a.id,
    person: personLabel(a),
    aboName: a.subscription?.name ?? null,
    source: aboSource(a.uuid),
    status: a.status,
    endDate: a.endDate?.toISOString() ?? null,
    suggestion: suggestions.get(personKey(a)) ?? null,
  }));
}
