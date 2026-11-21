/**
 * Kundenkonten für die Abos-Seite (Abos › Kundenkonten).
 *
 * Je Konto: Adresse(n), Personen und Abos mit ihrem Fahrer. Bearbeitet wird
 * über `PATCH /api/customers/persons/[id]` (Person; `DELETE` löscht eine
 * Person ohne Abo), `PUT
 * /api/tickets/[id]/rider` (Fahrer) und `POST /api/customers/[id]/merge`
 * (Konten zusammenlegen, lib/customers).
 */
import type { PrismaClient, TicketStatus } from "@prisma/client";
import { normalizeName } from "./ticket-predecessor";
import { lastInvites } from "./rider-invite";

const RUNNING: TicketStatus[] = ["VALID", "REDEEMED", "PAUSED"];
const MAX_CUSTOMERS = 2000;

export interface CustomerPersonRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  /** ISO-Datum (YYYY-MM-DD) oder null. */
  birthDate: string | null;
  /** Erstes Jahr an der Anlage (für die Treue-Awards), vom Personal gepflegt. */
  ridingSince: number | null;
  /** Meldet sich selbst in der Kunden-App an (Adresse, Passwort oder Passkey). */
  app: boolean;
  /** Tickets, mit denen die Person fährt (auch abgelaufene und aus anderen Konten). */
  tickets: number;
  /** Gehört in der App zu einer Familie. */
  family: boolean;
}

export interface CustomerAboRow {
  id: number;
  aboName: string;
  status: TicketStatus;
  /** Ende der Laufzeit, ISO; null = offen. */
  endDate: string | null;
  /** Läuft noch (gültig, eingelöst oder pausiert und nicht abgelaufen). */
  running: boolean;
  /** Person, die damit fährt; null = Fahrer offen. */
  riderId: number | null;
  /** Name und Geburtsdatum am Abo (bei anny die des Kontoinhabers). */
  ticketName: string;
  ticketBirthDate: string | null;
  lastName: string | null;
}

export interface CustomerAccountRow {
  id: number;
  email: string;
  aliasEmails: string[];
  /** Kontoinhaber (anny bzw. erstes Abo). */
  name: string | null;
  persons: CustomerPersonRow[];
  abos: CustomerAboRow[];
  /** Letzte Einladung zur Kunden-App an die Adresse, ISO; null = nie. */
  invitedAt: string | null;
}

export interface DuplicateGroup {
  /** Warum die Konten zusammengehören könnten. */
  reason: "name" | "anny";
  /** Name des Inhabers bzw. leer bei gleicher anny-Kundennummer. */
  label: string;
  ids: number[];
}

export interface CustomerAccountsData {
  rows: CustomerAccountRow[];
  duplicates: DuplicateGroup[];
}

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Konten, die vielleicht derselben Familie gehören: gleicher Inhabername oder
 * dieselbe anny-Kundennummer. Nur ein Vorschlag; zusammengelegt wird erst,
 * wenn jemand es bestätigt.
 */
export function findDuplicateGroups(
  customers: Array<{ id: number; name: string | null; annyCustomerIds: string[] }>,
): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const add = (reason: DuplicateGroup["reason"], label: string, ids: number[]) => {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const key = sorted.join(",");
    if (sorted.length < 2 || seen.has(key)) return;
    seen.add(key);
    groups.push({ reason, label, ids: sorted });
  };

  const byAnny = new Map<string, number[]>();
  for (const c of customers) {
    for (const a of c.annyCustomerIds) byAnny.set(a, [...(byAnny.get(a) ?? []), c.id]);
  }
  for (const ids of byAnny.values()) add("anny", "", ids);

  const byName = new Map<string, { label: string; ids: number[] }>();
  for (const c of customers) {
    const label = c.name?.trim().replace(/\s+/g, " ");
    const key = normalizeName(label);
    // Ein einzelnes Wort ist zu unsicher („Familie“, „Test“).
    if (!label || !key || !label.includes(" ")) continue;
    const g = byName.get(key) ?? { label, ids: [] };
    g.ids.push(c.id);
    byName.set(key, g);
  }
  for (const g of byName.values()) add("name", g.label, g.ids);
  return groups;
}

export async function loadCustomerAccounts(db: PrismaClient, accountId: number, now: Date = new Date()): Promise<CustomerAccountsData> {
  const customers = await db.customer.findMany({
    where: { accountId },
    select: {
      id: true,
      email: true,
      aliasEmails: true,
      name: true,
      annyCustomerIds: true,
      persons: {
        select: {
          id: true, firstName: true, lastName: true, birthDate: true, ridingSince: true, email: true, passwordHash: true,
          familyId: true, _count: { select: { passkeys: true, tickets: true } },
        },
        orderBy: { id: "asc" },
        take: 30,
      },
      tickets: {
        where: { subscriptionId: { not: null } },
        select: {
          id: true, name: true, firstName: true, lastName: true, birthDate: true, endDate: true, status: true,
          riderProfileId: true, subscription: { select: { name: true } },
        },
        orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { id: "desc" }],
        take: 50,
      },
    },
    orderBy: [{ name: { sort: "asc", nulls: "last" } }, { email: "asc" }],
    take: MAX_CUSTOMERS,
  });
  const invites = await lastInvites(accountId);

  const rows: CustomerAccountRow[] = customers.map((c) => ({
    id: c.id,
    email: c.email,
    aliasEmails: c.aliasEmails,
    name: c.name,
    invitedAt: invites.get(c.email.trim().toLowerCase())?.toISOString() ?? null,
    persons: c.persons.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      birthDate: isoDay(p.birthDate),
      ridingSince: p.ridingSince,
      app: p.email != null || p.passwordHash != null || p._count.passkeys > 0,
      tickets: p._count.tickets,
      family: p.familyId != null,
    })),
    abos: c.tickets
      .map((t) => ({
        id: t.id,
        aboName: t.subscription?.name ?? "Abo",
        status: t.status,
        endDate: t.endDate?.toISOString() ?? null,
        running: RUNNING.includes(t.status) && (t.endDate == null || t.endDate.getTime() > now.getTime()),
        riderId: t.riderProfileId,
        ticketName: [t.firstName, t.lastName].filter((v) => v?.trim()).join(" ").trim() || t.name,
        ticketBirthDate: isoDay(t.birthDate),
        lastName: t.lastName,
      }))
      // Laufende Abos zuerst, innerhalb davon wie geladen (jüngstes Ende oben).
      .sort((a, b) => Number(b.running) - Number(a.running)),
  }));

  return { rows, duplicates: findDuplicateGroups(customers) };
}
