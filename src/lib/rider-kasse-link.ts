/**
 * Abo an der Kasse mit der Kunden-App verknüpfen (Aaron, 20.11.2026:
 * „qr code scann an der kasse“).
 *
 * Liegt ein Abo nicht unter der Adresse, mit der sich jemand in der App
 * anmeldet (Abo ohne Adresse aus dem Reepay-Import oder von der Kasse, alte
 * oder andere Adresse, anny-Adresse anders als die in der App), zeigt die App
 * im Profil einen QR-Code, den App-Code (15 Minuten gültig). Am Shop-Monitor
 * scannt das Personal die Abo-Karte und den App-Code und wählt, wer fährt:
 *
 * - „selbst“: Das Abo fährt die Person der App. Ein Abo ohne Adresse bekommt
 *   die der App. Sonst kommt die App-Person ins Kundenkonto des Abos, und ihre
 *   Adresse wird eine weitere Adresse des Kontos: so findet auch die
 *   Anmeldung per Mail-Link das Konto, und der anny-Abgleich ändert nichts
 *   daran. Eine bisherige Person ohne eigene Adresse am Abo (etwa ein alter
 *   Zugang über den Link von der Kasse) wird mit der App-Person
 *   zusammengefasst.
 * - „Kind“: Die Person am Abo kommt als verwaltetes Mitglied in die Familie
 *   der App-Person. Ein Abo ohne Adresse bekommt die der App.
 *
 * Zwei verschiedene Kundenkonten legt nur die Verwaltung zusammen
 * (Abos › Kundenkonten).
 *
 * Hängt das Abo schon an einer anderen Person der App (eigene App, Kind einer
 * Familie, anderer Name), zeigt die Kasse, wo es steht (`aboAppOwner`), und
 * kann diese Verknüpfung nach Rückfrage lösen und neu verknüpfen
 * (`replace`, Aaron 21.11.2026: „das sollte man verwalten und auch wieder
 * lösen können“). Gelöst wird nur dieses Abo; Besuche, Starts und Awards
 * hängen am Abo und ziehen mit.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { cleanEmail } from "./abo-email";
import { aboNamesRider, isAdultAt, isKidsSubscriptionName } from "./customer-person";
import { customerIdForEmail, ensureCustomer, linkAboCustomer, RiderError, syncCustomerPersons } from "./customers";
import { newRiderToken } from "./rider-app";
import { assertRoom, ensureFamily, FamilyError, memberName, tidyFamily } from "./rider-family";
import { maskEmail } from "./rider-reset-key";
import { normalizeName } from "./ticket-predecessor";

export const APP_CODE_MINUTES = 15;
const CODE_RE = /^APP(\d{8})(\d{10})(\d{1,12})$/;

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function mac(profileId: number, exp: number): string {
  const h = createHmac("sha256", secret()).update(`rider-app-code:${profileId}.${exp}`).digest();
  return String(h.readUIntBE(0, 6) % 10_000_000_000).padStart(10, "0");
}

/**
 * App-Code für den QR-Code: nur Großbuchstaben und Ziffern, damit Scanner mit
 * deutschem oder US-Tastaturlayout dasselbe schicken.
 */
export function appCode(profileId: number, now: Date = new Date()): { code: string; expiresAt: Date } {
  const exp = Math.floor(now.getTime() / 60_000) + APP_CODE_MINUTES;
  return { code: `APP${String(exp).padStart(8, "0")}${mac(profileId, exp)}${profileId}`, expiresAt: new Date(exp * 60_000) };
}

/** null: kein App-Code; `invalid`: App-Code, aber falsch oder abgelaufen. */
export function readAppCode(raw: string, now: Date = new Date()): { profileId: number } | { invalid: true } | null {
  const value = String(raw ?? "").replace(/\s+/g, "").replace(/^[#%]+/, "").toUpperCase();
  const m = CODE_RE.exec(value);
  if (!m) return null;
  if (!secret()) return { invalid: true };
  const exp = Number(m[1]);
  const profileId = Number(m[3]);
  const a = Buffer.from(m[2]);
  const b = Buffer.from(mac(profileId, exp));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { invalid: true };
  if (exp * 60_000 < now.getTime()) return { invalid: true };
  return { profileId };
}

const TICKETS_FOR_NAME = {
  select: { firstName: true, name: true, endDate: true, subscriptionId: true },
  orderBy: { id: "desc" as const },
  take: 20,
};

export interface AppLinkInfo {
  profileId: number;
  name: string;
  maskedEmail: string | null;
  /** Die App gehört einem Kind der Familie; verknüpfen geht nur mit Erwachsenen. */
  child: boolean;
}

/** Wem gehört die gescannte App? Für die Rückfrage an der Kasse. */
export async function appLinkInfo(accountId: number, profileId: number): Promise<AppLinkInfo | null> {
  const p = await prisma.riderProfile.findFirst({
    where: { id: profileId, accountId },
    select: {
      firstName: true, nickname: true, email: true, familyId: true, familyAdult: true,
      customer: { select: { email: true } }, tickets: TICKETS_FOR_NAME,
    },
  });
  if (!p) return null;
  const email = cleanEmail(p.email) ?? cleanEmail(p.customer?.email);
  return { profileId, name: memberName(p), maskedEmail: email ? maskEmail(email) : null, child: p.familyId != null && !p.familyAdult };
}

export type AppLinkRole = "self" | "child";

/** Wo das Abo in der App steht; für die Kasse. */
export interface AboOwner {
  profileId: number;
  name: string;
  /** Eigener Zugang (Passwort oder Passkey). */
  ownApp: boolean;
  maskedEmail: string | null;
  /** Kind einer Familie: Name einer Erwachsenen der Familie. */
  familyOf: string | null;
}

/** Ein Satz für die Kasse: „Aaron, Kind in der Familie von Anna“. */
export function ownerText(o: AboOwner): string {
  if (o.familyOf) return `${o.name}, Kind in der Familie von ${o.familyOf}`;
  if (o.ownApp) return o.maskedEmail ? `App von ${o.name} (${o.maskedEmail})` : `App von ${o.name}`;
  return `${o.name}, noch ohne eigenen Zugang`;
}

/** Wer fährt in der App mit diesem Abo? Null, wenn es noch keiner Person gehört. */
export async function aboAppOwner(accountId: number, ticketId: number): Promise<AboOwner | null> {
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, accountId }, select: { riderProfileId: true } });
  if (t?.riderProfileId == null) return null;
  const r = await prisma.riderProfile.findFirst({
    where: { id: t.riderProfileId, accountId },
    select: {
      id: true, firstName: true, nickname: true, email: true, passwordHash: true, familyId: true, familyAdult: true,
      _count: { select: { passkeys: true } }, tickets: TICKETS_FOR_NAME,
    },
  });
  if (!r) return null;
  const adult = r.familyId != null && !r.familyAdult
    ? await prisma.riderProfile.findFirst({
        where: { accountId, familyId: r.familyId, familyAdult: true, id: { not: r.id } },
        select: { firstName: true, nickname: true, tickets: TICKETS_FOR_NAME },
        orderBy: { id: "asc" },
      })
    : null;
  const email = cleanEmail(r.email);
  return {
    profileId: r.id,
    name: memberName(r),
    ownApp: r.passwordHash != null || r._count.passkeys > 0,
    maskedEmail: email ? maskEmail(email) : null,
    familyOf: adult ? memberName(adult) : null,
  };
}

/**
 * Das Abo hängt schon an einer anderen Person der App. Die Kasse zeigt das
 * und bietet an, die Verknüpfung zu lösen (`replace`).
 */
export class AboLinkedError extends RiderError {
  readonly replaceable = true;
  constructor(message: string) {
    super(message, 409);
  }
}

/** Gleicher Vorname, oder einer fehlt: dann kann es dieselbe Person sein. */
export function sameFirstName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  return !x || !y || x === y;
}

function twoKonten(): RiderError {
  return new RiderError(
    "App und Abo gehören zu zwei verschiedenen Kundenkonten. Zusammenlegen geht in der Verwaltung unter Abos › Kundenkonten.",
    409,
  );
}

/**
 * Verknüpfen. Gibt die Meldung für die Kasse zurück; Fehler als `RiderError`
 * mit deutschem Text.
 */
export async function linkAboToApp(
  accountId: number,
  ticketId: number,
  profileId: number,
  role: AppLinkRole,
  now: Date = new Date(),
  replace = false,
): Promise<string> {
  const t = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: {
      id: true, subscriptionId: true, status: true, email: true, customerId: true, riderProfileId: true,
      firstName: true, lastName: true, birthDate: true, startDate: true, subscription: { select: { name: true } },
    },
  });
  if (!t || t.subscriptionId == null) throw new RiderError("Nur Abos lassen sich mit der App verknüpfen.");
  if (t.status === "CANCELED" || t.status === "INVALID") throw new RiderError("Dieses Abo ist storniert oder ungültig.");

  const p = await prisma.riderProfile.findFirst({
    where: { id: profileId, accountId },
    select: {
      id: true, email: true, customerId: true, familyId: true, familyAdult: true, firstName: true, nickname: true,
      customer: { select: { email: true } }, tickets: TICKETS_FOR_NAME,
    },
  });
  if (!p) throw new RiderError("Diese App kennen wir nicht.", 404);
  if (p.familyId != null && !p.familyAdult) {
    throw new RiderError("Das ist die App eines Kindes der Familie. Bitte die App eines Erwachsenen scannen.");
  }
  const name = memberName(p);
  const email = cleanEmail(p.email) ?? cleanEmail(p.customer?.email);
  const appKonto = p.customerId ?? (email ? await customerIdForEmail(accountId, email) : null);

  // Abo mit Adresse, aber noch ohne Konto (der Cron holt das sonst nach).
  let konto = t.customerId;
  if (konto == null && t.email) {
    await linkAboCustomer(accountId, t.id);
    konto = (await prisma.ticket.findUnique({ where: { id: t.id }, select: { customerId: true } }))?.customerId ?? null;
  }

  return role === "self"
    ? linkSelf({ accountId, t, p: { id: p.id, firstName: p.firstName, customerId: p.customerId }, name, email, appKonto, konto, replace })
    : linkChild({ accountId, t, p, name, email, konto, now, replace });
}

interface LinkTicket {
  id: number;
  email: string | null;
  riderProfileId: number | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: Date | null;
  startDate: Date | null;
  subscription: { name: string } | null;
}

async function linkSelf(a: {
  accountId: number;
  t: LinkTicket;
  p: { id: number; firstName: string | null; customerId: number | null };
  name: string;
  email: string | null;
  appKonto: number | null;
  konto: number | null;
  replace: boolean;
}): Promise<string> {
  const { accountId, t, p, name, email, appKonto, replace } = a;
  let konto = a.konto;
  if (konto != null && appKonto != null && appKonto !== konto) throw twoKonten();

  // Wer fuhr bisher? Dieselbe Person ohne eigene Adresse wird zusammengefasst.
  let prev = t.riderProfileId != null && t.riderProfileId !== p.id
    ? await prisma.riderProfile.findUnique({
        where: { id: t.riderProfileId },
        select: {
          id: true, email: true, customerId: true, firstName: true, lastName: true, birthDate: true, nickname: true,
          showInRanking: true, ridingSince: true, familyId: true, familyAdult: true, photo: true,
        },
      })
    : null;
  // Hängt das Abo an einer anderen Person (Familie, eigene App, anderer Name),
  // nur nach Rückfrage lösen: dann geht nur dieses Abo um, die Person bleibt.
  let released: { id: number; familyId: number | null } | null = null;
  if (prev) {
    const conflict =
      prev.familyId != null ? "family" : prev.email != null ? "app" : !sameFirstName(prev.firstName, p.firstName) ? "name" : null;
    if (conflict) {
      if (!replace) {
        const owner = await aboAppOwner(accountId, t.id);
        const where = owner ? ownerText(owner) : prev.firstName ?? "eine andere Person";
        throw new AboLinkedError(
          conflict === "name" && !owner?.familyOf
            ? `Am Abo fährt ${prev.firstName}, die App gehört ${name}. Fährt ein Kind damit? Dann „Kind“ wählen, sonst die bisherige Verknüpfung lösen.`
            : `Das Abo ist schon verknüpft: ${where}.`,
        );
      }
      released = { id: prev.id, familyId: prev.familyId };
      prev = null;
    } else if (prev.customerId != null && prev.customerId !== (konto ?? appKonto)) {
      // Die bisherige Person muss im selben Konto landen wie die App.
      throw twoKonten();
    }
  }

  if (konto == null && email) {
    // Abo ohne Adresse: bekommt die der App.
    await prisma.ticket.update({ where: { id: t.id }, data: { email, version: { increment: 1 } } });
    await linkAboCustomer(accountId, t.id);
    konto = (await prisma.ticket.findUnique({ where: { id: t.id }, select: { customerId: true } }))?.customerId ?? null;
  }

  await prisma.$transaction(async (tx) => {
    if (konto != null) {
      if (p.customerId == null) await tx.riderProfile.update({ where: { id: p.id }, data: { customerId: konto } });
      // Adresse der App als weitere Adresse des Kontos, wenn sie noch frei ist.
      if (email) {
        const c = await tx.customer.findUnique({ where: { id: konto }, select: { email: true, aliasEmails: true } });
        const owner = await tx.customer.findFirst({
          where: { accountId, OR: [{ email }, { aliasEmails: { has: email } }] },
          select: { id: true },
        });
        if (c && c.email !== email && !c.aliasEmails.includes(email) && owner == null) {
          await tx.customer.update({ where: { id: konto }, data: { aliasEmails: { push: email } } });
        }
      }
    }
    if (prev) {
      // Alle Abos der bisherigen Person gehen an die App-Person, ihre Daten auch, wo dort nichts steht.
      await tx.ticket.updateMany({ where: { accountId, riderProfileId: prev.id }, data: { riderProfileId: p.id } });
      const me = await tx.riderProfile.findUniqueOrThrow({
        where: { id: p.id },
        select: { firstName: true, lastName: true, birthDate: true, nickname: true, showInRanking: true, ridingSince: true, photo: true },
      });
      await tx.riderProfile.delete({ where: { id: prev.id } });
      await tx.riderProfile.update({
        where: { id: p.id },
        data: {
          firstName: me.firstName ?? prev.firstName,
          lastName: me.lastName ?? prev.lastName,
          birthDate: me.birthDate ?? prev.birthDate,
          nickname: me.nickname ?? prev.nickname,
          showInRanking: me.nickname != null ? me.showInRanking : prev.showInRanking,
          photo: me.photo ?? prev.photo,
          ridingSince: me.ridingSince == null ? prev.ridingSince : prev.ridingSince == null ? me.ridingSince : Math.min(me.ridingSince, prev.ridingSince),
        },
      });
    }
    await tx.ticket.update({ where: { id: t.id }, data: { riderProfileId: p.id } });
  });
  if (prev) console.log(`[rider-kasse-link] account=${accountId} Person ${prev.id} ohne Adresse in ${p.id} zusammengefasst`);
  if (released) {
    await dropEmptyPerson(accountId, released);
    console.log(`[rider-kasse-link] account=${accountId} Abo ${t.id} von Person ${released.id} gelöst, jetzt bei ${p.id}`);
  }
  // Zieht auch die Familie nach (syncKontoFamily).
  if (konto != null) await syncCustomerPersons(accountId, konto);
  return `Verknüpft. ${t.subscription?.name ?? "Das Abo"} steht jetzt in der App von ${name}.`;
}

/**
 * Nach dem Lösen: Hat die bisherige Person kein Abo mehr, keinen eigenen
 * Zugang und verwaltet keine Familie, fällt sie weg (sie war nur der Platz
 * für dieses Abo). Eine Familie mit nur noch einer Person löst sich auf.
 */
async function dropEmptyPerson(accountId: number, person: { id: number; familyId: number | null }): Promise<void> {
  await prisma.riderProfile.deleteMany({
    where: {
      id: person.id, accountId, email: null, passwordHash: null, familyAdult: false,
      tickets: { none: {} }, passkeys: { none: {} },
    },
  });
  if (person.familyId != null) await tidyFamily(person.familyId, accountId);
}

async function linkChild(a: {
  accountId: number;
  t: LinkTicket;
  p: { id: number; customerId: number | null; familyId: number | null; familyAdult: boolean };
  name: string;
  email: string | null;
  konto: number | null;
  now: Date;
  replace: boolean;
}): Promise<string> {
  const { accountId, t, p, name, email, now, replace } = a;
  if (t.riderProfileId === p.id) {
    throw new RiderError(`Mit dem Abo fährt ${name} selbst. Fährt ein Kind damit, erst den Fahrer am Abo ändern.`);
  }
  const existing = t.riderProfileId != null
    ? await prisma.riderProfile.findUnique({
        where: { id: t.riderProfileId },
        select: { id: true, firstName: true, nickname: true, birthDate: true, familyId: true, familyAdult: true, tickets: TICKETS_FOR_NAME },
      })
    : null;
  // Die Daten am Abo sind die des Fahrers, nicht die eines Elternteils am Kids-Abo.
  const ticketIsRider = !!t.firstName?.trim()
    && aboNamesRider({ kids: isKidsSubscriptionName(t.subscription?.name), birthDate: t.birthDate, startDate: t.startDate }, now);
  if (!existing && !ticketIsRider) {
    throw new RiderError("Am Abo fehlt der Fahrer. Bitte erst Vorname und Geburtsdatum des Kindes am Abo eintragen.");
  }
  const kidName = existing ? memberName(existing) : t.firstName!.trim();
  const kidBirth = existing?.birthDate ?? (ticketIsRider ? t.birthDate : null);
  if (isAdultAt(kidBirth, now) === true) {
    throw new RiderError(`${kidName} ist volljährig. Erwachsene lädt man in der App unter Familie per E-Mail ein.`);
  }
  // In einer anderen Familie: nur nach Rückfrage herüberholen, nie eine Erwachsene.
  const oldFamily = existing?.familyId != null && existing.familyId !== p.familyId ? existing.familyId : null;
  if (oldFamily != null) {
    if (existing!.familyAdult) throw new RiderError(`${kidName} verwaltet eine eigene Familie in der App und lässt sich nicht als Kind verknüpfen.`);
    if (!replace) {
      const owner = await aboAppOwner(accountId, t.id);
      throw new AboLinkedError(`Das Abo ist schon verknüpft: ${owner ? ownerText(owner) : `${kidName}, in einer anderen Familie`}.`);
    }
  }
  const joins = existing?.familyId == null || oldFamily != null;
  if (joins && p.familyId != null) await familyCall(() => assertRoom(p.familyId!, accountId, 1));

  // Abo ohne Adresse: bekommt die der App und kommt in ihr Konto.
  const adopt = a.konto == null && email != null;
  const konto = adopt ? await ensureCustomer(accountId, { email, name }) : a.konto;
  const kidId = await prisma.$transaction(async (tx) => {
    let id = existing?.id ?? null;
    if (id == null) {
      const person = await tx.riderProfile.create({
        data: {
          token: newRiderToken(), accountId, customerId: konto,
          firstName: t.firstName?.trim() || null, lastName: t.lastName?.trim() || null, birthDate: t.birthDate,
        },
        select: { id: true },
      });
      id = person.id;
    }
    await tx.ticket.update({
      where: { id: t.id },
      data: { riderProfileId: id, ...(adopt && konto != null && { email, customerId: konto, version: { increment: 1 } }) },
    });
    if (adopt && konto != null && p.customerId == null) {
      await tx.riderProfile.update({ where: { id: p.id }, data: { customerId: konto } });
    }
    return id;
  });

  if (joins) {
    const familyId = await familyCall(() => ensureFamily({ id: p.id, accountId, familyId: p.familyId, familyAdult: p.familyAdult }));
    await prisma.riderProfile.update({ where: { id: kidId }, data: { familyId, familyAdult: false } });
    if (oldFamily != null) {
      await tidyFamily(oldFamily, accountId);
      console.log(`[rider-kasse-link] account=${accountId} Person ${kidId} aus Familie ${oldFamily} gelöst, jetzt bei ${p.id}`);
    }
  }
  if (konto != null) await syncCustomerPersons(accountId, konto);
  return joins
    ? `Verknüpft. ${kidName} gehört jetzt zur Familie von ${name}.`
    : `Verknüpft. ${kidName} gehörte schon zur Familie von ${name}.`;
}

/** Fehler der Familie als Meldung für die Kasse. */
async function familyCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof FamilyError) throw new RiderError(e.message);
    throw e;
  }
}
