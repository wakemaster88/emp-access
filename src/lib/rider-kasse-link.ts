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
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { cleanEmail } from "./abo-email";
import { aboNamesRider, isAdultAt, isKidsSubscriptionName } from "./customer-person";
import { customerIdForEmail, ensureCustomer, linkAboCustomer, RiderError, syncCustomerPersons } from "./customers";
import { newRiderToken } from "./rider-app";
import { assertRoom, ensureFamily, FamilyError, memberName } from "./rider-family";
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
    ? linkSelf({ accountId, t, p: { id: p.id, firstName: p.firstName, customerId: p.customerId }, name, email, appKonto, konto })
    : linkChild({ accountId, t, p, name, email, konto, now });
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
}): Promise<string> {
  const { accountId, t, p, name, email, appKonto } = a;
  let konto = a.konto;
  if (konto != null && appKonto != null && appKonto !== konto) throw twoKonten();

  // Wer fuhr bisher? Dieselbe Person ohne eigene Adresse wird zusammengefasst.
  const prev = t.riderProfileId != null && t.riderProfileId !== p.id
    ? await prisma.riderProfile.findUnique({
        where: { id: t.riderProfileId },
        select: {
          id: true, email: true, customerId: true, firstName: true, lastName: true, birthDate: true, nickname: true,
          showInRanking: true, ridingSince: true, familyId: true, photo: true,
        },
      })
    : null;
  if (prev) {
    if (prev.familyId != null) {
      throw new RiderError(`Das Abo gehört in der App zu einer Familie (${prev.firstName ?? "ohne Namen"}). Bitte dort verwalten oder „Kind“ wählen.`);
    }
    if (prev.email != null) {
      throw new RiderError(`Das Abo hängt schon an einer App mit eigener Adresse (${maskEmail(prev.email)}). Bitte diese App nutzen.`);
    }
    if (!sameFirstName(prev.firstName, p.firstName)) {
      throw new RiderError(`Am Abo fährt ${prev.firstName}, die App gehört ${p.firstName}. Fährt ein Kind damit? Dann „Kind“ wählen.`);
    }
    // Die bisherige Person muss im selben Konto landen wie die App.
    if (prev.customerId != null && prev.customerId !== (konto ?? appKonto)) throw twoKonten();
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
  // Zieht auch die Familie nach (syncKontoFamily).
  if (konto != null) await syncCustomerPersons(accountId, konto);
  return `Verknüpft. ${t.subscription?.name ?? "Das Abo"} steht jetzt in der App von ${name}.`;
}

async function linkChild(a: {
  accountId: number;
  t: LinkTicket;
  p: { id: number; customerId: number | null; familyId: number | null; familyAdult: boolean };
  name: string;
  email: string | null;
  konto: number | null;
  now: Date;
}): Promise<string> {
  const { accountId, t, p, name, email, now } = a;
  if (t.riderProfileId === p.id) {
    throw new RiderError(`Mit dem Abo fährt ${name} selbst. Fährt ein Kind damit, erst den Fahrer am Abo ändern.`);
  }
  const existing = t.riderProfileId != null
    ? await prisma.riderProfile.findUnique({
        where: { id: t.riderProfileId },
        select: { id: true, firstName: true, nickname: true, birthDate: true, familyId: true, tickets: TICKETS_FOR_NAME },
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
  if (existing?.familyId != null && existing.familyId !== p.familyId) {
    throw new RiderError(`${kidName} gehört schon zu einer anderen Familie.`);
  }
  const joins = existing?.familyId == null;
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
