/**
 * Familie in der Kunden-App.
 *
 * Eine Familie bündelt Profile. Gezählt wird weiter je Person: Statistik,
 * Meilensteine und Gutscheine gehören dem einzelnen Mitglied.
 *
 * - Erwachsene (`familyAdult`) haben einen eigenen Zugang, sehen alle
 *   Mitglieder und verwalten die Kinder. Einstellungen und Zugang ändert
 *   jeder nur für sich selbst.
 * - Kinder brauchen keinen eigenen Zugang; die Erwachsenen sehen ihr Abo,
 *   ihre Statistik und ihre Gutscheine.
 * - Wege in die Familie: Personen des eigenen Kundenkontos von selbst
 *   (lib/customers `syncKontoFamily`), Kinder an der Kasse per App-Code
 *   (lib/rider-kasse-link), über den persönlichen Link von der Kasse
 *   (`addFamilyChild`) oder mit eigener Adresse per Bestätigungslink
 *   (lib/rider-family-link), Partner per Einladungslink. Per Kartennummer
 *   geht es nicht mehr (Aaron, 20.11.2026).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";

export const FAMILY_MAX_MEMBERS = 10;
export const FAMILY_INVITE_DAYS = 7;

export interface FamilyPerson {
  id: number;
  accountId: number;
  familyId: number | null;
  familyAdult: boolean;
}

/** Was darf `viewer` bei `target`? Nichts, ansehen (Partner) oder verwalten (Kind). */
export type FamilyRelation = "self" | "manage" | "view" | null;

export function familyRelation(viewer: FamilyPerson | null, target: FamilyPerson): FamilyRelation {
  if (!viewer) return null;
  if (viewer.id === target.id) return "self";
  if (viewer.accountId !== target.accountId) return null;
  if (viewer.familyId == null || viewer.familyId !== target.familyId || !viewer.familyAdult) return null;
  return target.familyAdult ? "view" : "manage";
}

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`rider-family-invite:${payload}`).digest("base64url");
}

/**
 * Schlüssel im Einladungslink `/app/familie/<schlüssel>` für den Partner.
 * `version` ist der Zähler `RiderFamily.inviteVersion`: Ein neuer geteilter
 * Link erhöht ihn, ältere Schlüssel gelten dann nicht mehr. Schlüssel ohne
 * Version stammen aus der Zeit davor und gelten, solange der Zähler auf 0 steht.
 */
export function familyInviteKey(familyId: number, inviterId: number, now: Date = new Date(), version?: number): string {
  const exp = Math.floor(now.getTime() / 1000) + FAMILY_INVITE_DAYS * 86_400;
  const payload = version === undefined ? `${familyId}.${inviterId}.${exp}` : `${familyId}.${inviterId}.${exp}.${version}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyFamilyInviteKey(
  value: string,
  now: Date = new Date(),
): { familyId: number; inviterId: number; version?: number } | null {
  const m = /^(\d{1,12})\.(\d{1,12})\.(\d{1,12})(?:\.(\d{1,9}))?\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m || !secret()) return null;
  const payload = m[4] === undefined ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  const a = Buffer.from(m[5]);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(m[3]) * 1000 <= now.getTime()) return null;
  const link = { familyId: Number(m[1]), inviterId: Number(m[2]) };
  return m[4] === undefined ? link : { ...link, version: Number(m[4]) };
}

/** Gilt ein Schlüssel mit dieser Version (ohne: aus der Zeit vor dem Zähler) beim aktuellen Zählerstand? */
export function inviteVersionMatches(keyVersion: number | undefined, current: number): boolean {
  return (keyVersion ?? 0) === current;
}

export interface FamilyMember {
  profileId: number;
  token: string;
  name: string;
  adult: boolean;
  /** Hat einen eigenen Zugang (Passkey oder Passwort). */
  hasLogin: boolean;
  /** Kundenkonto der Person (lib/customers); Personen eines Kontos bleiben zusammen. */
  customerId: number | null;
}

const MEMBER_SELECT = {
  id: true,
  token: true,
  firstName: true,
  nickname: true,
  customerId: true,
  familyAdult: true,
  passwordHash: true,
  email: true,
  _count: { select: { passkeys: true } },
  tickets: {
    select: { firstName: true, name: true, endDate: true, subscriptionId: true },
    orderBy: { id: "desc" as const },
    take: 20,
  },
};

type MemberRow = {
  id: number; token: string; firstName: string | null; nickname: string | null; customerId: number | null; familyAdult: boolean; passwordHash: string | null; email: string | null;
  _count: { passkeys: number };
  tickets: Array<{ firstName: string | null; name: string; endDate: Date | null; subscriptionId: number | null }>;
};

/** Anzeigename: Vorname der Person, sonst vom Abo-Ticket, sonst Spitzname. */
export function memberName(p: Pick<MemberRow, "nickname" | "tickets"> & { firstName?: string | null }): string {
  const abo = p.tickets.find((t) => t.subscriptionId != null) ?? p.tickets[0];
  return p.firstName?.trim() || abo?.firstName?.trim() || p.nickname?.trim() || abo?.name?.trim() || "Mitglied";
}

function toMember(p: MemberRow): FamilyMember {
  return {
    profileId: p.id,
    token: p.token,
    name: memberName(p),
    adult: p.familyAdult,
    hasLogin: p.passwordHash != null || p._count.passkeys > 0,
    customerId: p.customerId,
  };
}

/** Mitglieder einer Familie: Erwachsene zuerst, dann nach Namen. */
export async function loadFamilyMembers(familyId: number, accountId: number): Promise<FamilyMember[]> {
  const rows = await prisma.riderProfile.findMany({ where: { familyId, accountId }, select: MEMBER_SELECT });
  return rows
    .filter((r) => r.tickets.length > 0 || r.email != null)
    .map(toMember)
    .sort((a, b) => Number(b.adult) - Number(a.adult) || a.name.localeCompare(b.name, "de"));
}

/** Familie ohne Erwachsene oder mit nur einem Mitglied auflösen. */
export async function tidyFamily(familyId: number, accountId: number): Promise<void> {
  const members = await prisma.riderProfile.findMany({ where: { familyId, accountId }, select: { familyAdult: true } });
  if (members.length >= 2 && members.some((m) => m.familyAdult)) return;
  await prisma.$transaction([
    prisma.riderProfile.updateMany({ where: { familyId, accountId }, data: { familyId: null, familyAdult: false } }),
    prisma.riderFamily.deleteMany({ where: { id: familyId, accountId } }),
  ]);
}

/** Familie der angemeldeten Person holen oder anlegen; sie wird dabei Erwachsene. */
export async function ensureFamily(viewer: FamilyPerson): Promise<number> {
  if (viewer.familyId != null) {
    if (!viewer.familyAdult) throw new FamilyError("Nur Erwachsene der Familie können Mitglieder hinzufügen.");
    return viewer.familyId;
  }
  const family = await prisma.riderFamily.create({ data: { accountId: viewer.accountId }, select: { id: true } });
  await prisma.riderProfile.update({ where: { id: viewer.id }, data: { familyId: family.id, familyAdult: true } });
  return family.id;
}

/** Fehler mit einem Text, den die App dem Gast zeigt. */
export class FamilyError extends Error {}

export async function assertRoom(familyId: number, accountId: number, adding = 1): Promise<void> {
  const count = await prisma.riderProfile.count({ where: { familyId, accountId } });
  if (count + adding > FAMILY_MAX_MEMBERS) throw new FamilyError(`Eine Familie hat höchstens ${FAMILY_MAX_MEMBERS} Mitglieder.`);
}

/**
 * Ein Profil ohne eigenen Zugang als Kind in die Familie von `viewer` holen.
 * Wer schon einen eigenen Zugang hat, entscheidet selbst und braucht den
 * Einladungslink.
 */
export async function addFamilyChild(viewer: FamilyPerson, targetProfileId: number): Promise<void> {
  if (targetProfileId === viewer.id) throw new FamilyError("Das bist du selbst.");
  const target = await prisma.riderProfile.findFirst({
    where: { id: targetProfileId, accountId: viewer.accountId },
    select: { id: true, familyId: true, passwordHash: true, _count: { select: { passkeys: true } } },
  });
  if (!target) throw new FamilyError("Dieses Abo kennen wir nicht.");
  if (target.familyId != null) {
    throw new FamilyError(
      target.familyId === viewer.familyId ? "Dieses Mitglied gehört schon zu deiner Familie." : "Dieses Abo gehört schon zu einer anderen Familie.",
    );
  }
  if (target.passwordHash != null || target._count.passkeys > 0) {
    throw new FamilyError("Diese Person hat einen eigenen Zugang. Hol sie über ihre E-Mail-Adresse dazu, dann bestätigt sie per Link.");
  }
  const familyId = await ensureFamily(viewer);
  await assertRoom(familyId, viewer.accountId);
  await prisma.riderProfile.updateMany({
    where: { id: target.id, accountId: viewer.accountId, familyId: null },
    data: { familyId, familyAdult: false },
  });
}

/**
 * Einladungslink für den Partner; legt die Familie an, wenn es noch keine
 * gibt. Jeder neue Link erhöht den Zähler der Familie: ältere Einladungslinks
 * (auch die aus Einladungs-Mails) gelten danach nicht mehr.
 */
export async function createFamilyInvite(viewer: FamilyPerson): Promise<string> {
  const familyId = await ensureFamily(viewer);
  const family = await prisma.riderFamily.update({
    where: { id: familyId },
    data: { inviteVersion: { increment: 1 } },
    select: { inviteVersion: true },
  });
  return `/app/familie/${familyInviteKey(familyId, viewer.id, new Date(), family.inviteVersion)}`;
}

/** Aktueller Zähler der Einladungslinks einer Familie (für die Einladung per Mail). */
export async function familyInviteVersion(familyId: number): Promise<number> {
  const family = await prisma.riderFamily.findUnique({ where: { id: familyId }, select: { inviteVersion: true } });
  return family?.inviteVersion ?? 0;
}

/** Wer lädt ein? Für die Seite hinter dem Einladungslink; null, wenn er nicht mehr gilt. */
export async function familyInviteInfo(key: string): Promise<{ familyId: number; accountId: number; inviterName: string } | null> {
  const link = verifyFamilyInviteKey(key);
  if (!link) return null;
  const inviter = await prisma.riderProfile.findFirst({
    where: { id: link.inviterId, familyId: link.familyId, familyAdult: true },
    select: { accountId: true, firstName: true, nickname: true, email: true, tickets: MEMBER_SELECT.tickets, family: { select: { inviteVersion: true } } },
  });
  if (!inviter || (inviter.tickets.length === 0 && !inviter.email)) return null;
  if (!inviter.family || !inviteVersionMatches(link.version, inviter.family.inviteVersion)) return null;
  return { familyId: link.familyId, accountId: inviter.accountId, inviterName: memberName(inviter) };
}

/**
 * Der Einladung folgen: die angemeldete Person wird Erwachsene der Familie.
 * Verwaltet sie schon eine eigene Familie nur mit Kindern (etwa die Personen
 * ihres Kundenkontos), kommen die Kinder mit; mit weiteren Erwachsenen muss
 * sie die alte Familie zuerst verlassen. Gibt die Familie zurück, wenn sich
 * etwas geändert hat (für die Nachricht an die übrigen Erwachsenen), sonst null.
 */
export async function joinFamily(person: FamilyPerson, key: string): Promise<number | null> {
  const invite = await familyInviteInfo(key);
  if (!invite || invite.accountId !== person.accountId) throw new FamilyError("Diese Einladung gilt nicht mehr.");
  if (person.familyId === invite.familyId) {
    if (person.familyAdult) return null;
    await prisma.riderProfile.update({ where: { id: person.id }, data: { familyAdult: true } });
    return invite.familyId;
  }
  const others = person.familyId != null
    ? await prisma.riderProfile.findMany({
        where: { familyId: person.familyId, accountId: person.accountId, id: { not: person.id } },
        select: { id: true, familyAdult: true },
      })
    : [];
  if (others.length > 0 && (!person.familyAdult || others.some((o) => o.familyAdult))) {
    throw new FamilyError("Du gehörst schon zu einer Familie mit weiteren Erwachsenen. Verlasse sie zuerst in deinem Profil.");
  }
  await assertRoom(invite.familyId, person.accountId, 1 + others.length);
  const old = person.familyId;
  await prisma.$transaction([
    prisma.riderProfile.update({ where: { id: person.id }, data: { familyId: invite.familyId, familyAdult: true } }),
    prisma.riderProfile.updateMany({
      where: { id: { in: others.map((o) => o.id) }, accountId: person.accountId, familyId: old ?? -1 },
      data: { familyId: invite.familyId, familyAdult: false },
    }),
  ]);
  if (old != null) await tidyFamily(old, person.accountId);
  return invite.familyId;
}

/**
 * Kinder, die eine Erwachsene beim Verlassen mitnimmt: Mitglieder ohne
 * Erwachsenen-Rolle aus ihrem Kundenkonto. Gehört eine weitere Erwachsene
 * der Familie zum selben Konto, bleiben sie (sie gehören beiden).
 */
export function childrenLeavingWith(
  me: { id: number; customerId: number | null },
  others: Array<{ id: number; familyAdult: boolean; customerId: number | null }>,
): number[] {
  if (me.customerId == null) return [];
  const rest = others.filter((o) => o.id !== me.id);
  if (rest.some((o) => o.familyAdult && o.customerId === me.customerId)) return [];
  return rest.filter((o) => !o.familyAdult && o.customerId === me.customerId).map((o) => o.id);
}

/**
 * Die Familie verlassen. Eine Erwachsene nimmt die Kinder aus ihrem
 * Kundenkonto mit (`childrenLeavingWith`), sie bilden dann ihre eigene
 * Familie. Geht die letzte Erwachsene, löst sich die Familie auf.
 */
export async function leaveFamily(person: FamilyPerson): Promise<void> {
  if (person.familyId == null) return;
  const familyId = person.familyId;
  let kids: number[] = [];
  if (person.familyAdult) {
    const members = await prisma.riderProfile.findMany({
      where: { familyId, accountId: person.accountId },
      select: { id: true, familyAdult: true, customerId: true },
    });
    const me = members.find((m) => m.id === person.id);
    if (me) kids = childrenLeavingWith(me, members);
  }
  if (kids.length === 0) {
    await prisma.riderProfile.update({ where: { id: person.id }, data: { familyId: null, familyAdult: false } });
  } else {
    const ownId = await prisma.$transaction(async (tx) => {
      const own = await tx.riderFamily.create({ data: { accountId: person.accountId }, select: { id: true } });
      await tx.riderProfile.update({ where: { id: person.id }, data: { familyId: own.id, familyAdult: true } });
      await tx.riderProfile.updateMany({
        where: { id: { in: kids }, accountId: person.accountId, familyId, familyAdult: false },
        data: { familyId: own.id },
      });
      return own.id;
    });
    // Kam inzwischen keins der Kinder mit, bleibt keine Familie aus einer Person.
    await tidyFamily(ownId, person.accountId);
  }
  await tidyFamily(familyId, person.accountId);
}

/**
 * Ein Kind aus der Familie nehmen. Partner gehen nur selbst. Personen aus dem
 * Kundenkonto der Erwachsenen bleiben: sie kämen beim nächsten Abgleich
 * ohnehin wieder (lib/customers `syncKontoFamily`).
 */
export async function removeFamilyChild(viewer: FamilyPerson, targetProfileId: number): Promise<void> {
  if (viewer.familyId == null || !viewer.familyAdult) throw new FamilyError("Das geht nur als Erwachsene der Familie.");
  const [me, target] = await Promise.all([
    prisma.riderProfile.findUnique({ where: { id: viewer.id }, select: { customerId: true } }),
    prisma.riderProfile.findFirst({ where: { id: targetProfileId, accountId: viewer.accountId }, select: { customerId: true } }),
  ]);
  if (me?.customerId != null && target?.customerId === me.customerId) {
    throw new FamilyError("Dieses Mitglied gehört zu deinem Kundenkonto und bleibt deshalb in der Familie.");
  }
  const removed = await prisma.riderProfile.updateMany({
    where: { id: targetProfileId, accountId: viewer.accountId, familyId: viewer.familyId, familyAdult: false },
    data: { familyId: null },
  });
  if (removed.count === 0) throw new FamilyError("Dieses Mitglied kannst du nicht entfernen.");
  await tidyFamily(viewer.familyId, viewer.accountId);
}
