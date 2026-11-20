/**
 * Kundenkonten und Personen (Etappe 2, Variante B).
 *
 * - `ensureCustomer`: Konto zur E-Mail-Adresse holen oder anlegen. Mit
 *   anny-Kundennummer folgt das Konto einer Adressänderung in anny.
 * - `syncCustomerPersons`: wer fährt mit welchem Abo des Kontos (Regeln in
 *   `customer-person.ts`). Legt fehlende Personen an, ändert nie eine
 *   bestehende Zuordnung.
 * - `linkAboCustomer`: ein Abo-Ticket nach dem Speichern seinem Konto
 *   zuordnen (Backend, Shop-Monitor).
 * - `runCustomerTick`: Cron tick-5min, holt alle Abos mit Adresse nach, die
 *   noch kein Konto haben (Bestandsdaten, verpasste Schreibwege).
 * - `assignRider`, `updatePersonData`: Kasse und Abo-Seite sagen, wer mit
 *   einem Abo fährt, und pflegen Name, Geburtsdatum und „Fährt seit“ der Person.
 * - `mergeCustomers`: zwei Konten derselben Familie zusammenlegen. Die
 *   Adresse des übernommenen Kontos bleibt als weitere Adresse
 *   (`aliasEmails`); `customerIdForEmail` und `ensureCustomer` finden das
 *   Konto auch darüber.
 *
 * Tagestickets bekommen kein Konto; sie finden ihr Profil weiter über die
 * Adresse (`day-guest.ts`).
 */
import { prisma } from "./prisma";
import { cleanEmail } from "./abo-email";
import { aboCategory, aboNamesRider, isKidsSubscriptionName, personDataKey, pickHolder, planPersons } from "./customer-person";
import { newRiderToken } from "./rider-app";

/** Namensraum für pg_advisory_xact_lock(int, int): ein Lauf je Konto zugleich. */
const LOCK_NS = 7301;
/** So viele Abo-Tickets holt ein Cron-Lauf höchstens nach. */
const TICK_TICKETS = 400;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2002";
}

const CUSTOMER_SELECT = { id: true, email: true, name: true, annyCustomerIds: true } as const;

/** Konto zur Adresse: Hauptadresse oder weitere Adresse nach dem Zusammenlegen. */
export async function customerIdForEmail(accountId: number, email: string): Promise<number | null> {
  const main = await prisma.customer.findUnique({ where: { accountId_email: { accountId, email } }, select: { id: true } });
  if (main) return main.id;
  const alias = await prisma.customer.findFirst({
    where: { accountId, aliasEmails: { has: email } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return alias?.id ?? null;
}

export async function ensureCustomer(
  accountId: number,
  input: { email: string | null | undefined; name?: string | null; annyCustomerId?: string | number | null },
): Promise<number | null> {
  const email = cleanEmail(input.email);
  if (!email) return null;
  const anny = input.annyCustomerId != null ? String(input.annyCustomerId).trim() || null : null;
  const name = input.name?.trim() || null;

  let c = await prisma.customer.findUnique({ where: { accountId_email: { accountId, email } }, select: CUSTOMER_SELECT });
  if (!c) {
    // Weitere Adresse eines zusammengelegten Kontos: Name bleibt der des Kontos.
    const alias = await prisma.customer.findFirst({
      where: { accountId, aliasEmails: { has: email } },
      select: CUSTOMER_SELECT,
      orderBy: { id: "asc" },
    });
    if (alias) {
      if (anny && !alias.annyCustomerIds.includes(anny)) {
        await prisma.customer.update({ where: { id: alias.id }, data: { annyCustomerIds: { push: anny } } });
      }
      return alias.id;
    }
  }
  if (!c && anny) {
    // Adresse in anny geändert: dasselbe Konto, neue Adresse. Die alte bleibt
    // als weitere Adresse (ältere Abos, Anmeldung in der App).
    const moved = await prisma.customer.findMany({
      where: { accountId, annyCustomerIds: { has: anny } },
      select: CUSTOMER_SELECT,
      take: 2,
    });
    if (moved.length === 1) {
      try {
        c = await prisma.customer.update({
          where: { id: moved[0].id },
          data: { email, aliasEmails: { push: moved[0].email } },
          select: CUSTOMER_SELECT,
        });
        console.log(`[customers] account=${accountId} Konto ${c.id}: Adresse aus anny geändert`);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }
  if (!c) {
    try {
      c = await prisma.customer.create({
        data: { accountId, email, name, annyCustomerIds: anny ? [anny] : [] },
        select: CUSTOMER_SELECT,
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      c = await prisma.customer.findUnique({ where: { accountId_email: { accountId, email } }, select: CUSTOMER_SELECT });
      if (!c) throw e;
    }
  }

  const data: { annyCustomerIds?: { push: string }; name?: string } = {};
  if (anny && !c.annyCustomerIds.includes(anny)) data.annyCustomerIds = { push: anny };
  // anny hält den Namen des Kontoinhabers aktuell, sonst nur ergänzen.
  if (name && (anny ? c.name !== name : !c.name)) data.name = name;
  if (Object.keys(data).length > 0) await prisma.customer.update({ where: { id: c.id }, data });
  return c.id;
}

export interface PersonSyncResult {
  created: number;
  assigned: number;
  open: number;
}

/** Personen eines Kontos nachziehen. Ein Lauf je Konto zugleich (Sperre). */
export async function syncCustomerPersons(accountId: number, customerId: number, now: Date = new Date()): Promise<PersonSyncResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NS}::int, ${customerId}::int)`;

    const customer = await tx.customer.findFirst({ where: { id: customerId, accountId }, select: { id: true, email: true } });
    if (!customer) return { created: 0, assigned: 0, open: 0 };

    const [tickets, subscriptions] = await Promise.all([
      tx.ticket.findMany({
        where: { accountId, customerId, subscriptionId: { not: null } },
        select: { id: true, firstName: true, lastName: true, birthDate: true, startDate: true, endDate: true, status: true, subscriptionId: true, riderProfileId: true },
        orderBy: { id: "asc" },
        take: 200,
      }),
      tx.subscription.findMany({ where: { accountId }, select: { id: true, name: true } }),
    ]);

    // Profile aus der Zeit vor dem Konto: über ihre Abos oder ihre Adresse.
    const linkedIds = [...new Set(tickets.map((t) => t.riderProfileId).filter((v): v is number => v != null))];
    await tx.riderProfile.updateMany({
      where: { accountId, customerId: null, OR: [{ id: { in: linkedIds } }, { email: customer.email }] },
      data: { customerId },
    });
    const persons = await tx.riderProfile.findMany({
      where: { accountId, customerId },
      select: { id: true, firstName: true, lastName: true, birthDate: true },
      orderBy: { id: "asc" },
    });

    const kids = new Set(subscriptions.filter((s) => isKidsSubscriptionName(s.name)).map((s) => s.id));
    const subName = new Map(subscriptions.map((s) => [s.id, s.name]));
    const plan = planPersons(
      tickets.map((t) => ({
        ...t,
        kids: t.subscriptionId != null && kids.has(t.subscriptionId),
        category: aboCategory(t.subscriptionId, t.subscriptionId != null ? subName.get(t.subscriptionId) : null),
      })),
      persons,
      now,
    );

    let assigned = 0;
    for (const a of plan.assign) {
      const r = await tx.ticket.updateMany({
        where: { accountId, id: { in: a.ticketIds }, riderProfileId: null },
        data: { riderProfileId: a.personId },
      });
      assigned += r.count;
    }
    for (const c of plan.create) {
      const person = await tx.riderProfile.create({
        data: { token: newRiderToken(), accountId, customerId, firstName: c.firstName, lastName: c.lastName, birthDate: c.birthDate },
        select: { id: true },
      });
      const r = await tx.ticket.updateMany({
        where: { accountId, id: { in: c.ticketIds }, riderProfileId: null },
        data: { riderProfileId: person.id },
      });
      assigned += r.count;
    }

    // Personen ohne eigene Daten bekommen sie von ihrem jüngsten Abo, das
    // Fahrer-Daten trägt (nicht vom Kids-Abo mit den Daten der Eltern).
    for (const p of persons) {
      if (p.firstName || p.lastName || p.birthDate) continue;
      const own = await tx.ticket.findMany({
        where: { accountId, riderProfileId: p.id, subscriptionId: { not: null } },
        select: { firstName: true, lastName: true, birthDate: true, startDate: true, subscriptionId: true },
        orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        take: 20,
      });
      const latest = own.find((t) => aboNamesRider({ ...t, kids: t.subscriptionId != null && kids.has(t.subscriptionId) }, now));
      if (latest && (latest.firstName || latest.lastName)) {
        await tx.riderProfile.update({
          where: { id: p.id },
          data: { firstName: latest.firstName, lastName: latest.lastName, birthDate: latest.birthDate },
        });
      }
    }

    return { created: plan.create.length, assigned, open: plan.open.length };
  }, { timeout: 20_000 });
}

/** Abo-Ticket nach dem Speichern seinem Konto zuordnen und die Personen nachziehen. */
export async function linkAboCustomer(accountId: number, ticketId: number): Promise<void> {
  const t = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: {
      id: true, email: true, subscriptionId: true, customerId: true, name: true, firstName: true, lastName: true,
      riderProfile: { select: { customerId: true, email: true, passwordHash: true, _count: { select: { passkeys: true } } } },
    },
  });
  if (!t || t.subscriptionId == null) return;
  const name = [t.firstName, t.lastName].filter((v) => v?.trim()).join(" ").trim() || t.name;
  const customerId = await ensureCustomer(accountId, { email: t.email, name });
  if (customerId == null) return;
  if (t.customerId !== customerId) {
    // Neue Adresse, anderes Konto: eine Person des alten Kontos ohne eigenen
    // Zugang fährt das Abo nicht mehr mit, das neue Konto ordnet neu zu.
    const p = t.riderProfile;
    const detach = p != null && p.customerId != null && p.customerId !== customerId
      && p.email == null && p.passwordHash == null && p._count.passkeys === 0;
    await prisma.ticket.update({ where: { id: t.id }, data: { customerId, ...(detach && { riderProfileId: null }) } });
  }
  await syncCustomerPersons(accountId, customerId);
}

/** Wie `linkAboCustomer`, aber ohne Fehler nach außen (nach dem eigentlichen Speichern). */
export async function linkAboCustomerSafe(accountId: number, ticketId: number): Promise<void> {
  try {
    await linkAboCustomer(accountId, ticketId);
  } catch (err) {
    console.error(`[customers] account=${accountId} Ticket ${ticketId}: Konto nicht zugeordnet:`, err instanceof Error ? err.message : String(err));
  }
}

export interface CustomerTickResult {
  tickets: number;
  customers: number;
  personsCreated: number;
  assigned: number;
  open: number;
}

/**
 * Abos mit Adresse ohne Konto nachholen (Cron tick-5min). Arbeitet in
 * Portionen; der nächste Lauf macht weiter.
 */
export async function runCustomerTick(now: Date = new Date()): Promise<CustomerTickResult> {
  const result: CustomerTickResult = { tickets: 0, customers: 0, personsCreated: 0, assigned: 0, open: 0 };
  const rows = await prisma.ticket.findMany({
    where: { subscriptionId: { not: null }, customerId: null, email: { not: null }, NOT: { email: "" } },
    select: { id: true, accountId: true, email: true, uuid: true, name: true, firstName: true, lastName: true },
    orderBy: { id: "asc" },
    take: TICK_TICKETS,
  });
  const touched = new Map<string, { accountId: number; customerId: number }>();
  for (const t of rows) {
    const anny = t.uuid?.startsWith("anny-sub:") ? t.uuid.split(":")[1] || null : null;
    const name = [t.firstName, t.lastName].filter((v) => v?.trim()).join(" ").trim() || t.name;
    const customerId = await ensureCustomer(t.accountId, { email: t.email, name, annyCustomerId: anny });
    if (customerId == null) continue;
    await prisma.ticket.updateMany({ where: { id: t.id, customerId: null }, data: { customerId } });
    result.tickets += 1;
    touched.set(`${t.accountId}:${customerId}`, { accountId: t.accountId, customerId });
  }
  for (const { accountId, customerId } of touched.values()) {
    const r = await syncCustomerPersons(accountId, customerId, now);
    result.customers += 1;
    result.personsCreated += r.created;
    result.assigned += r.assigned;
    result.open += r.open;
  }
  return result;
}

/** Person, die sich mit der Adresse des Kontos anmeldet (siehe `pickHolder`). */
export async function holderPersonForEmail(
  accountId: number,
  email: string,
): Promise<{ id: number; token: string; email: string | null } | null> {
  const customerId = await customerIdForEmail(accountId, email);
  if (customerId == null) return null;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      name: true,
      persons: {
        select: {
          id: true, token: true, email: true, firstName: true, lastName: true,
          tickets: { where: { subscriptionId: { not: null } }, select: { subscription: { select: { name: true } } }, take: 20 },
        },
        orderBy: { id: "asc" },
        take: 20,
      },
    },
  });
  if (!customer || customer.persons.length === 0) return null;
  const id = pickHolder(
    customer.persons.map((p) => ({
      id: p.id,
      email: p.email,
      firstName: p.firstName,
      lastName: p.lastName,
      adultAbo: p.tickets.some((t) => !isKidsSubscriptionName(t.subscription?.name)),
    })),
    email,
    customer.name,
  );
  const p = customer.persons.find((x) => x.id === id);
  return p ? { id: p.id, token: p.token, email: p.email } : null;
}

/** Fehler mit Meldung für die Oberfläche (deutsch) und HTTP-Status. */
export class RiderError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

export type RiderInput =
  | { personId: number }
  | { firstName: string | null; lastName: string | null; birthDate: Date | null };

function cleanName(v: string | null | undefined): string | null {
  const s = v?.trim().replace(/\s+/g, " ");
  return s ? s.slice(0, 80) : null;
}

/**
 * Sagt, wer mit einem Abo fährt: eine Person desselben Kundenkontos oder eine
 * neue mit Vorname, Nachname und Geburtsdatum. Gibt es im Konto schon eine
 * Person mit genau diesen Daten, bekommt sie das Abo.
 */
export async function assignRider(
  accountId: number,
  ticketId: number,
  input: RiderInput,
): Promise<{ personId: number; created: boolean }> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: { id: true, subscriptionId: true, customerId: true },
  });
  if (!ticket) throw new RiderError("Abo nicht gefunden.", 404);
  if (ticket.subscriptionId == null) throw new RiderError("Einen Fahrer gibt es nur bei Abos.");
  const customerId = ticket.customerId;
  if (customerId == null) {
    throw new RiderError("Das Abo hat noch keine E-Mail-Adresse. Trag sie zuerst ein, dann den Fahrer.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NS}::int, ${customerId}::int)`;
    let personId: number;
    let created = false;
    if ("personId" in input) {
      const person = await tx.riderProfile.findFirst({
        where: { id: input.personId, accountId, customerId },
        select: { id: true },
      });
      if (!person) throw new RiderError("Diese Person gehört nicht zum Kundenkonto des Abos.");
      personId = person.id;
    } else {
      const data = { firstName: cleanName(input.firstName), lastName: cleanName(input.lastName), birthDate: input.birthDate };
      if (!data.firstName && !data.lastName) throw new RiderError("Bitte Vor- oder Nachnamen des Fahrers eintragen.");
      if (data.birthDate && (isNaN(data.birthDate.getTime()) || data.birthDate.getTime() > Date.now())) {
        throw new RiderError("Das Geburtsdatum stimmt nicht.");
      }
      const key = personDataKey(data);
      const persons = await tx.riderProfile.findMany({
        where: { accountId, customerId },
        select: { id: true, firstName: true, lastName: true, birthDate: true },
      });
      const same = persons.find((p) => personDataKey(p) === key);
      if (same) {
        personId = same.id;
      } else {
        const person = await tx.riderProfile.create({
          data: { token: newRiderToken(), accountId, customerId, ...data },
          select: { id: true },
        });
        personId = person.id;
        created = true;
      }
    }
    await tx.ticket.update({ where: { id: ticket.id }, data: { riderProfileId: personId } });
    return { personId, created };
  });
}

/** Frühestes Jahr, das bei „Fährt seit“ eingetragen werden kann. */
export const RIDING_SINCE_MIN = 1960;

/** Name und Geburtsdatum einer Person ändern (nur übergebene Felder). */
export async function updatePersonData(
  accountId: number,
  personId: number,
  input: { firstName?: string | null; lastName?: string | null; birthDate?: Date | null; ridingSince?: number | null },
): Promise<void> {
  const data: { firstName?: string | null; lastName?: string | null; birthDate?: Date | null; ridingSince?: number | null } = {};
  if (input.firstName !== undefined) data.firstName = cleanName(input.firstName);
  if (input.lastName !== undefined) data.lastName = cleanName(input.lastName);
  if (input.birthDate !== undefined) {
    if (input.birthDate && (isNaN(input.birthDate.getTime()) || input.birthDate.getTime() > Date.now())) {
      throw new RiderError("Das Geburtsdatum stimmt nicht.");
    }
    data.birthDate = input.birthDate;
  }
  if (input.ridingSince !== undefined) {
    const year = input.ridingSince;
    if (year != null && (!Number.isInteger(year) || year < RIDING_SINCE_MIN || year > new Date().getFullYear())) {
      throw new RiderError("Das Jahr bei „Fährt seit“ stimmt nicht.");
    }
    data.ridingSince = year;
  }
  if (Object.keys(data).length === 0) return;
  const r = await prisma.riderProfile.updateMany({ where: { id: personId, accountId }, data });
  if (r.count === 0) throw new RiderError("Person nicht gefunden.", 404);
}

export interface MergeResult {
  abos: number;
  persons: number;
  /** Doppelte Personen (gleiche Daten, ohne eigenen Zugang), die zusammengefasst wurden. */
  folded: number;
}

/** Eine Person ohne eigenen Zugang und ohne Spuren in der App. */
function isPlainPerson(p: {
  email: string | null; passwordHash: string | null; nickname: string | null; lastSeenAt: Date | null; familyId: number | null;
  _count: { passkeys: number; pushSubscriptions: number };
}): boolean {
  return p.email == null && p.passwordHash == null && p.nickname == null && p.lastSeenAt == null && p.familyId == null
    && p._count.passkeys === 0 && p._count.pushSubscriptions === 0;
}

/**
 * Zwei Konten zusammenlegen: Abos und Personen von `fromId` kommen nach
 * `intoId`. Die Adressen von `fromId` bleiben als weitere Adressen, damit neue
 * Abos (anny, Kasse) dort landen. Personen mit gleichen Daten werden
 * zusammengefasst, wenn eine davon keinen eigenen Zugang hat.
 */
export async function mergeCustomers(accountId: number, intoId: number, fromId: number): Promise<MergeResult> {
  if (intoId === fromId) throw new RiderError("Ein Konto lässt sich nicht mit sich selbst zusammenlegen.");
  const result = await prisma.$transaction(async (tx) => {
    // Beide Konten sperren, immer in derselben Reihenfolge.
    for (const id of [intoId, fromId].sort((a, b) => a - b)) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NS}::int, ${id}::int)`;
    }
    const select = { id: true, email: true, name: true, annyCustomerIds: true, aliasEmails: true } as const;
    const [into, from] = await Promise.all([
      tx.customer.findFirst({ where: { id: intoId, accountId }, select }),
      tx.customer.findFirst({ where: { id: fromId, accountId }, select }),
    ]);
    if (!into || !from) throw new RiderError("Kundenkonto nicht gefunden.", 404);

    const abos = await tx.ticket.updateMany({ where: { accountId, customerId: from.id }, data: { customerId: into.id } });
    const persons = await tx.riderProfile.updateMany({ where: { accountId, customerId: from.id }, data: { customerId: into.id } });
    await tx.customer.delete({ where: { id: from.id } });
    const aliasEmails = [...new Set([...into.aliasEmails, from.email, ...from.aliasEmails])].filter((e) => e !== into.email);
    await tx.customer.update({
      where: { id: into.id },
      data: {
        aliasEmails,
        annyCustomerIds: [...new Set([...into.annyCustomerIds, ...from.annyCustomerIds])],
        ...(!into.name && from.name && { name: from.name }),
      },
    });

    // Gleiche Person in beiden Konten (Name und Geburtsdatum): eine behalten.
    const all = await tx.riderProfile.findMany({
      where: { accountId, customerId: into.id },
      select: {
        id: true, firstName: true, lastName: true, birthDate: true, email: true, passwordHash: true, nickname: true,
        lastSeenAt: true, familyId: true, ridingSince: true, _count: { select: { passkeys: true, pushSubscriptions: true } },
      },
      orderBy: { id: "asc" },
    });
    const groups = new Map<string, typeof all>();
    for (const p of all) {
      const key = personDataKey(p);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    let folded = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // Wer einen Zugang hat, bleibt; sonst die älteste Person.
      const keep = group.find((p) => !isPlainPerson(p)) ?? group[0];
      let since = keep.ridingSince;
      for (const p of group) {
        if (p.id === keep.id || !isPlainPerson(p)) continue;
        await tx.ticket.updateMany({ where: { accountId, riderProfileId: p.id }, data: { riderProfileId: keep.id } });
        await tx.riderProfile.delete({ where: { id: p.id } });
        // „Fährt seit“ der zusammengefassten Person bleibt, das frühere Jahr gilt.
        if (p.ridingSince != null && (since == null || p.ridingSince < since)) since = p.ridingSince;
        folded += 1;
      }
      if (since !== keep.ridingSince) await tx.riderProfile.update({ where: { id: keep.id }, data: { ridingSince: since } });
    }
    return { abos: abos.count, persons: persons.count, folded };
  }, { timeout: 20_000 });
  // Abos ohne Fahrer finden jetzt vielleicht eine Person des anderen Kontos.
  await syncCustomerPersons(accountId, intoId);
  console.log(`[customers] account=${accountId} Konto ${fromId} in ${intoId} übernommen: ${result.abos} Abos, ${result.persons} Personen, ${result.folded} zusammengefasst`);
  return result;
}
