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
 *   (lib/customers `syncKontoFamily`), Kinder per Kartennummer und
 *   Geburtsdatum (`addFamilyChild`) oder mit eigener Adresse per
 *   Bestätigungslink (lib/rider-family-link), Partner per Einladungslink.
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

/** Schlüssel im Einladungslink `/app/familie/<schlüssel>` für den Partner. */
export function familyInviteKey(familyId: number, inviterId: number, now: Date = new Date()): string {
  const payload = `${familyId}.${inviterId}.${Math.floor(now.getTime() / 1000) + FAMILY_INVITE_DAYS * 86_400}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyFamilyInviteKey(value: string, now: Date = new Date()): { familyId: number; inviterId: number } | null {
  const m = /^(\d{1,12})\.(\d{1,12})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m || !secret()) return null;
  const a = Buffer.from(m[4]);
  const b = Buffer.from(sign(`${m[1]}.${m[2]}.${m[3]}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(m[3]) * 1000 <= now.getTime()) return null;
  return { familyId: Number(m[1]), inviterId: Number(m[2]) };
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

/** Einladungslink für den Partner; legt die Familie an, wenn es noch keine gibt. */
export async function createFamilyInvite(viewer: FamilyPerson): Promise<string> {
  const familyId = await ensureFamily(viewer);
  return `/app/familie/${familyInviteKey(familyId, viewer.id)}`;
}

/** Wer lädt ein? Für die Seite hinter dem Einladungslink; null, wenn er nicht mehr gilt. */
export async function familyInviteInfo(key: string): Promise<{ familyId: number; accountId: number; inviterName: string } | null> {
  const link = verifyFamilyInviteKey(key);
  if (!link) return null;
  const inviter = await prisma.riderProfile.findFirst({
    where: { id: link.inviterId, familyId: link.familyId, familyAdult: true },
    select: { accountId: true, firstName: true, nickname: true, email: true, tickets: MEMBER_SELECT.tickets },
  });
  if (!inviter || (inviter.tickets.length === 0 && !inviter.email)) return null;
  return { familyId: link.familyId, accountId: inviter.accountId, inviterName: memberName(inviter) };
}

/** Der Einladung folgen: die angemeldete Person wird Erwachsene der Familie. */
export async function joinFamily(person: FamilyPerson, key: string): Promise<void> {
  const invite = await familyInviteInfo(key);
  if (!invite || invite.accountId !== person.accountId) throw new FamilyError("Diese Einladung gilt nicht mehr.");
  if (person.familyId === invite.familyId) {
    if (!person.familyAdult) await prisma.riderProfile.update({ where: { id: person.id }, data: { familyAdult: true } });
    return;
  }
  if (person.familyId != null) {
    const others = await prisma.riderProfile.count({ where: { familyId: person.familyId, accountId: person.accountId, id: { not: person.id } } });
    if (others > 0) throw new FamilyError("Du gehörst schon zu einer Familie. Verlasse sie zuerst in deinem Profil.");
  }
  await assertRoom(invite.familyId, person.accountId);
  const old = person.familyId;
  await prisma.riderProfile.update({ where: { id: person.id }, data: { familyId: invite.familyId, familyAdult: true } });
  if (old != null) await tidyFamily(old, person.accountId);
}

/** Die Familie verlassen. Geht die letzte Erwachsene, löst sich die Familie auf. */
export async function leaveFamily(person: FamilyPerson): Promise<void> {
  if (person.familyId == null) return;
  await prisma.riderProfile.update({ where: { id: person.id }, data: { familyId: null, familyAdult: false } });
  await tidyFamily(person.familyId, person.accountId);
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
