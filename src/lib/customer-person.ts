/**
 * Wer fährt mit welchem Abo eines Kundenkontos? (Etappe 2, Variante B)
 *
 * Ein Kundenkonto hängt an einer E-Mail-Adresse. Bei anny-Familienkonten
 * tragen alle Abos Name und Geburtsdatum des Kontoinhabers, auch das Abo des
 * Kindes. Die Regeln:
 *
 * 1. Ein Abo, das schon einer Person gehört (Kasse, App), behält sie.
 * 2. Ein Kids-Abo mit einem Geburtsdatum ab 18 Jahren geht nie automatisch an
 *    eine Person: „Fahrer offen“.
 * 3. Abos mit gleichem Vor-, Nachnamen und Geburtsdatum gehören derselben
 *    Person, solange sie nacheinander laufen (Verlängerung, Wechsel von Kids
 *    auf Ride). Läuft ein Fahr-Abo (Ride, Ride + Gear, Kids) gleichzeitig mit
 *    einem Fahr-Abo dieser Person, gehört es jemand anderem: „Fahrer offen“.
 *    Abos anderer Art (Beach, Aqua) darf dieselbe Person nebenher haben.
 *    Gekündigte oder vorzeitig ungültige Abos zählen dabei nicht mit.
 * 4. Gibt es für die Daten noch keine Person, entsteht sie aus dem Abo.
 *
 * Reine Funktion; angewendet wird der Plan in `customers.ts`.
 */
import { canBeSamePerson } from "./abo-person";
import { normalizeName } from "./ticket-predecessor";

/** Bis zu diesem Alter gilt das Kids Abo (Annahme, offene Frage an Aaron). */
export const KIDS_MAX_AGE = 18;

export interface PlanTicket {
  id: number;
  firstName: string | null;
  lastName: string | null;
  birthDate: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  /** Abo für Kinder (Kids Abo). */
  kids: boolean;
  /** Art des Abos (`aboCategory`): gleichzeitig nur eins je Art und Person. */
  category: string;
  status: string;
  riderProfileId: number | null;
}

export interface PlanPerson {
  id: number;
  firstName: string | null;
  lastName: string | null;
  birthDate: Date | null;
}

export interface PersonPlan {
  /** Neue Personen mit ihren Abos; Daten vom jüngsten Abo. */
  create: Array<{ firstName: string | null; lastName: string | null; birthDate: Date | null; ticketIds: number[] }>;
  /** Bestehende Personen bekommen diese Abos. */
  assign: Array<{ personId: number; ticketIds: number[] }>;
  /** Fahrer offen: Abos ohne Person. */
  open: number[];
}

/** Vergleichsform aus Vorname, Nachname und Geburtstag; leer ohne Namen. */
export function personDataKey(p: { firstName: string | null; lastName: string | null; birthDate: Date | null }): string {
  const first = normalizeName(p.firstName);
  const last = normalizeName(p.lastName);
  if (!first && !last) return "";
  return `${first}|${last}|${p.birthDate ? p.birthDate.toISOString().slice(0, 10) : ""}`;
}

/** Volljährig zu Beginn des Abos (ohne Beginn: heute)? Ohne Geburtsdatum unbekannt. */
export function isAdultAt(birthDate: Date | null, at: Date): boolean | null {
  if (!birthDate) return null;
  const limit = new Date(birthDate);
  limit.setUTCFullYear(limit.getUTCFullYear() + KIDS_MAX_AGE);
  return limit.getTime() <= at.getTime();
}

/** Kids Abo am Namen erkennen („Kids Abo“, „Kinder-Abo“). */
export function isKidsSubscriptionName(name: string | null | undefined): boolean {
  return /\bkids?\b|kinder/i.test(name ?? "");
}

/**
 * Art eines Abos: alle Fahr-Abos (Ride, Ride + Gear, Kids) sind eine Art, denn
 * man fährt nur mit einem. Andere Abos (Beach, Aqua) sind je eine eigene Art.
 */
export function aboCategory(subscriptionId: number | null, name: string | null | undefined): string {
  return /\bride\b|\bkids?\b|kinder|wake|wasserski/i.test(name ?? "") ? "ride" : `abo-${subscriptionId ?? 0}`;
}

export interface FollowUpAbo {
  id: number;
  /** `aboCategory` */
  category: string;
  endDate: Date | null;
}

/**
 * Hat die Person nach `abo` schon ein weiteres Abo derselben Art, das länger
 * läuft (verlängert oder neu gebucht)? Dann braucht es keine Ablauf-Mail.
 * `others` sind die laufenden Abos derselben Person.
 */
export function hasFollowUpAbo(abo: FollowUpAbo, others: FollowUpAbo[]): boolean {
  if (!abo.endDate) return false;
  const end = abo.endDate.getTime();
  return others.some((o) => o.id !== abo.id && o.category === abo.category && (o.endDate == null || o.endDate.getTime() > end));
}

/** Ein gekündigtes oder vorzeitig ungültiges Abo hat seine Laufzeit nicht genutzt. */
function usedPeriod(t: PlanTicket, now: Date): boolean {
  if (t.status !== "CANCELED" && t.status !== "INVALID") return true;
  return t.endDate != null && t.endDate.getTime() <= now.getTime();
}

/** Können zwei Abos mit gleichen Daten derselben Person gehören? */
function compatible(a: PlanTicket, b: PlanTicket, now: Date): boolean {
  if (a.category !== b.category || !usedPeriod(a, now) || !usedPeriod(b, now)) return true;
  return canBeSamePerson(a, b);
}

/**
 * Taugen Name und Geburtsdatum am Abo als Daten des Fahrers? Nicht bei einem
 * Kids-Abo mit Erwachsenen-Geburtsdatum: dort steht das Elternteil.
 */
export function aboNamesRider(t: { kids: boolean; birthDate: Date | null; startDate: Date | null }, now: Date = new Date()): boolean {
  return !(t.kids && isAdultAt(t.birthDate, t.startDate ?? now) === true);
}

interface Chain {
  personId: number | null;
  key: string;
  /**
   * Weitere Daten, unter denen die Person schon Abos hat. Ändert jemand in
   * der App seinen Namen (Tippfehler, Heirat), steht bei anny weiter der alte
   * am Abo; die Verlängerung soll trotzdem zu ihm finden.
   */
  aliases: Set<string>;
  tickets: PlanTicket[];
  added: PlanTicket[];
}

export function planPersons(tickets: PlanTicket[], persons: PlanPerson[], now: Date = new Date()): PersonPlan {
  const chains: Chain[] = persons.map((p) => {
    const own = tickets.filter((t) => t.riderProfileId === p.id);
    // Ohne eigene Daten zählt die Person wie ihr jüngstes Abo mit Fahrer-Daten.
    const latest = own
      .filter((t) => aboNamesRider(t, now))
      .sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0))[0];
    const key = personDataKey(p) || (latest ? personDataKey(latest) : "");
    const aliases = new Set(own.filter((t) => aboNamesRider(t, now)).map(personDataKey).filter((k) => k && k !== key));
    return { personId: p.id, key, aliases, tickets: own, added: [] };
  });

  // Abos, die schon einer Person gehören (auch einer fremden), bleiben, wie sie sind.
  const free = tickets.filter((t) => t.riderProfileId == null);

  // Kids-Abos von Kindern zuerst, damit sie die Person mit Kinder-Daten
  // bekommen; sonst nach Beginn.
  const rank = (t: PlanTicket) => (t.kids && isAdultAt(t.birthDate, t.startDate ?? now) === false ? 0 : 1);
  free.sort((a, b) => rank(a) - rank(b) || (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0) || a.id - b.id);

  const open: number[] = [];
  for (const t of free) {
    if (!aboNamesRider(t, now)) {
      open.push(t.id);
      continue;
    }
    const key = personDataKey(t);
    if (!key) {
      open.push(t.id);
      continue;
    }
    // Zuerst die Person mit genau diesen Daten, sonst eine, die unter diesen
    // Daten schon ein Abo hat.
    const exact = chains.filter((c) => c.key === key);
    const same = exact.length > 0 ? exact : chains.filter((c) => c.aliases.has(key));
    const fits = same.find((c) => c.tickets.every((o) => compatible(o, t, now)));
    if (fits) {
      fits.tickets.push(t);
      fits.added.push(t);
    } else if (same.length === 0) {
      chains.push({ personId: null, key, aliases: new Set(), tickets: [t], added: [t] });
    } else {
      open.push(t.id);
    }
  }

  // Personen ohne Daten und ohne Abo (in der App per E-Mail angemeldet, bevor
  // es ein Abo gab) übernehmen eine neue Person, am liebsten die mit einem
  // Abo für Erwachsene und dem jüngsten Beginn.
  const latestStart = (c: Chain) => Math.max(...c.tickets.map((t) => t.startDate?.getTime() ?? 0));
  const unbound = chains.filter((c) => c.personId != null && c.key === "" && c.tickets.length === 0);
  for (const u of unbound) {
    const target = chains
      .filter((c) => c.personId == null)
      .sort((a, b) => Number(a.tickets.every((t) => t.kids)) - Number(b.tickets.every((t) => t.kids)) || latestStart(b) - latestStart(a))[0];
    if (!target) break;
    target.personId = u.personId;
  }

  const plan: PersonPlan = { create: [], assign: [], open };
  for (const c of chains) {
    if (c.added.length === 0) continue;
    const ids = c.added.map((t) => t.id);
    if (c.personId != null) {
      plan.assign.push({ personId: c.personId, ticketIds: ids });
    } else {
      const latest = [...c.added].sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0) || b.id - a.id)[0];
      plan.create.push({ firstName: latest.firstName, lastName: latest.lastName, birthDate: latest.birthDate, ticketIds: ids });
    }
  }
  return plan;
}

export interface HolderCandidate {
  id: number;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Hat ein Abo, das kein Kids Abo ist. */
  adultAbo: boolean;
}

/**
 * Wer meldet sich vermutlich mit der Adresse eines Kontos an? Der
 * Kontoinhaber: zuerst die Person mit seinem Namen, dann eine mit einem Abo
 * für Erwachsene. Hat das Konto nur Kinder-Abos, fährt der Inhaber selbst
 * nicht (null). Personen mit einer anderen bestätigten Adresse scheiden aus.
 * Nur ein Vorschlag: In der App bestätigt der Kunde, wer er ist.
 */
export function pickHolder(candidates: HolderCandidate[], customerEmail: string, customerName: string | null): number | null {
  const holderName = normalizeName(customerName);
  const score = (p: HolderCandidate) => {
    if (holderName && normalizeName(`${p.firstName ?? ""}${p.lastName ?? ""}`) === holderName) return 0;
    return p.adultAbo ? 1 : 2;
  };
  const pool = candidates.filter((p) => (p.email == null || p.email === customerEmail) && score(p) < 2);
  pool.sort((a, b) => score(a) - score(b) || a.id - b.id);
  return pool[0]?.id ?? null;
}

export interface RiderSource {
  firstName: string | null;
  lastName: string | null;
  birthDate: Date | null;
  subscriptionId: number | null;
  customerId: number | null;
  riderProfileId: number | null;
  riderProfile?: { firstName: string | null; lastName: string | null; birthDate: Date | null } | null;
}

export interface RiderView {
  firstName: string | null;
  lastName: string | null;
  birthDate: Date | null;
  /** Abo mit Kundenkonto, aber noch ohne Person: wer fährt, ist unbekannt. */
  riderOpen: boolean;
}

/**
 * Name und Geburtsdatum, die Kasse, Scanner und Backend für ein Ticket zeigen:
 * die der Person, wenn das Abo einer Person mit Namen gehört, sonst die am
 * Ticket (bei anny die des Kontoinhabers).
 */
export function riderView(t: RiderSource): RiderView {
  const p = t.riderProfile;
  const riderOpen = t.subscriptionId != null && t.customerId != null && t.riderProfileId == null;
  if (p && (p.firstName?.trim() || p.lastName?.trim())) {
    return { firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate, riderOpen };
  }
  return { firstName: t.firstName, lastName: t.lastName, birthDate: t.birthDate, riderOpen };
}

/** Ticket mit den Daten der Person statt der Rohdaten; `riderProfile` fällt weg. */
export function withRiderView<T extends RiderSource>(t: T): Omit<T, "riderProfile"> & RiderView {
  const { riderProfile: _omit, ...rest } = t;
  void _omit;
  return { ...rest, ...riderView(t) };
}

/** Hat die Kasse andere Fahrer-Daten eingetragen, als am Abo stehen? */
export function riderDataEntered(
  ticket: { firstName: string | null; lastName: string | null; birthDate: Date | null },
  input: { firstName: string | null; lastName: string | null; birthDate: Date | null },
): boolean {
  if (!normalizeName(input.firstName) && !normalizeName(input.lastName)) return false;
  return personDataKey(input) !== personDataKey(ticket);
}
