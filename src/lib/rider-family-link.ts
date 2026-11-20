/**
 * Kind mit eigener Adresse in die Familie holen.
 *
 * Hat ein Kind sein Abo mit einer eigenen Adresse gebucht, gehört es zu einem
 * eigenen Kundenkonto (lib/customers). Die Erwachsene gibt diese Adresse in
 * der App ein (Profil › Familie), wir schicken an genau diese Adresse einen
 * Link. Wer ihn öffnet, sieht, wer einlädt, wählt die Personen des Kontos aus
 * und bestätigt; erst dann kommen sie als verwaltete Mitglieder in die
 * Familie. Ob es die Adresse gibt, erfährt die Erwachsene nicht.
 *
 * Nur Personen unter 18 (oder ohne Geburtsdatum) kommen in Frage;
 * Erwachsene treten mit dem Einladungslink für Partner bei.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { customerIdForEmail } from "./customers";
import { isAdultAt } from "./customer-person";
import { normalizeEmail } from "./day-guest";
import { sendEmail } from "./email-sender";
import { assertRoom, ensureFamily, FamilyError, memberName, type FamilyPerson } from "./rider-family";
import { familyChildMail } from "./rider-mail-template";

export const FAMILY_CHILD_LINK_DAYS = 7;
export const FAMILY_CHILD_MAIL_SUBJECT = "Familie in der App bestätigen";
const MAIL_PAUSE_MINUTES = 10;
const MAIL_MAX_PER_DAY = 3;
const MAX_PERSONS = 10;

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`rider-family-child:${payload}`).digest("base64url");
}

/** Schlüssel im Link `/app/familie/kind/<schlüssel>`: wer einlädt, welches Konto, bis wann. */
export function familyChildKey(inviterId: number, customerId: number, now: Date = new Date()): string {
  const payload = `${inviterId}.${customerId}.${Math.floor(now.getTime() / 1000) + FAMILY_CHILD_LINK_DAYS * 86_400}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyFamilyChildKey(value: string, now: Date = new Date()): { inviterId: number; customerId: number } | null {
  const m = /^(\d{1,12})\.(\d{1,12})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m || !secret()) return null;
  const a = Buffer.from(m[4]);
  const b = Buffer.from(sign(`${m[1]}.${m[2]}.${m[3]}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(m[3]) * 1000 <= now.getTime()) return null;
  return { inviterId: Number(m[1]), customerId: Number(m[2]) };
}

export interface ChildRow {
  id: number;
  name: string;
  birthDate: Date | null;
  familyId: number | null;
  visible: boolean;
}

export interface ChildCandidate {
  id: number;
  name: string;
  /** Gehört schon zur Familie der Einladenden. */
  joined: boolean;
}

/**
 * Wer aus dem Konto des Kindes in Frage kommt: sichtbare Personen ohne
 * Familie (oder schon in dieser), nicht volljährig.
 */
export function childCandidates(rows: ChildRow[], familyId: number | null, now: Date = new Date()): ChildCandidate[] {
  return rows
    .filter((r) => r.visible && isAdultAt(r.birthDate, now) !== true)
    .filter((r) => r.familyId == null || (familyId != null && r.familyId === familyId))
    .map((r) => ({ id: r.id, name: r.name, joined: r.familyId != null }));
}

async function kontoRows(accountId: number, customerId: number): Promise<ChildRow[]> {
  const rows = await prisma.riderProfile.findMany({
    where: { accountId, customerId },
    select: {
      id: true, firstName: true, nickname: true, birthDate: true, familyId: true, email: true,
      tickets: {
        select: { firstName: true, name: true, endDate: true, subscriptionId: true, birthDate: true },
        orderBy: { id: "desc" },
        take: 20,
      },
    },
    orderBy: { id: "asc" },
    take: 30,
  });
  return rows.map((r) => ({
    id: r.id,
    name: memberName(r),
    birthDate: r.birthDate ?? r.tickets.find((t) => t.subscriptionId != null)?.birthDate ?? null,
    familyId: r.familyId,
    visible: r.tickets.length > 0 || r.email != null,
  }));
}

/** Die Einladende darf (noch) Mitglieder holen: ohne Familie oder als Erwachsene. */
async function inviterOf(inviterId: number) {
  const p = await prisma.riderProfile.findUnique({
    where: { id: inviterId },
    select: {
      id: true, accountId: true, familyId: true, familyAdult: true, customerId: true, firstName: true, nickname: true, email: true,
      tickets: { select: { firstName: true, name: true, endDate: true, subscriptionId: true }, orderBy: { id: "desc" }, take: 20 },
    },
  });
  if (!p || (p.familyId != null && !p.familyAdult)) return null;
  if (p.tickets.length === 0 && !p.email) return null;
  return p;
}

/**
 * Link anfordern. Schickt höchstens alle paar Minuten und wenige Male am Tag
 * eine Mail an die Adresse, und nur, wenn zu ihr ein anderes Kundenkonto mit
 * Kindern gehört. Gibt zurück, ob eine Mail rausging (nur für Tests und Logs,
 * nicht für die Antwort an die App).
 */
export async function requestFamilyChildLink(viewer: FamilyPerson, rawEmail: unknown, origin: string, now: Date = new Date()): Promise<boolean> {
  if (viewer.familyId != null && !viewer.familyAdult) throw new FamilyError("Nur Erwachsene der Familie können Mitglieder hinzufügen.");
  const email = normalizeEmail(rawEmail);
  if (!email) throw new FamilyError("Bitte gib eine gültige E-Mail-Adresse ein.");

  const inviter = await inviterOf(viewer.id);
  if (!inviter) return false;
  const customerId = await customerIdForEmail(viewer.accountId, email);
  // Personen aus dem eigenen Konto kommen ohnehin von selbst (syncKontoFamily).
  if (customerId == null || customerId === inviter.customerId) return false;
  const free = childCandidates(await kontoRows(viewer.accountId, customerId), inviter.familyId, now).filter((c) => !c.joined);
  if (free.length === 0) return false;

  const config = await prisma.emailConfig.findUnique({ where: { accountId: viewer.accountId } });
  if (!config || !config.isActive || !config.apiKey) return false;
  const recent = await prisma.emailSend.findMany({
    where: {
      accountId: viewer.accountId,
      subject: FAMILY_CHILD_MAIL_SUBJECT,
      to: { equals: email, mode: "insensitive" },
      sentAt: { gte: new Date(now.getTime() - 86_400_000) },
    },
    select: { sentAt: true },
  });
  const pauseFrom = now.getTime() - MAIL_PAUSE_MINUTES * 60_000;
  if (recent.length >= MAIL_MAX_PER_DAY || recent.some((r) => r.sentAt.getTime() > pauseFrom)) return false;

  const account = await prisma.account.findUnique({ where: { id: viewer.accountId }, select: { name: true } });
  const url = `${origin}/app/familie/kind/${familyChildKey(inviter.id, customerId, now)}`;
  const content = familyChildMail({
    url,
    accountName: account?.name ?? "",
    origin,
    inviterName: memberName(inviter),
    days: FAMILY_CHILD_LINK_DAYS,
  });
  const result = await sendEmail({ config, to: email, subject: content.subject, html: content.html, text: content.text });
  await prisma.emailSend
    .create({
      data: {
        accountId: viewer.accountId,
        to: email,
        subject: FAMILY_CHILD_MAIL_SUBJECT,
        status: result.ok ? "SENT" : "FAILED",
        errorMessage: result.ok ? null : (result.error ?? "Unbekannter Fehler").slice(0, 500),
      },
    })
    .catch(() => null);
  return result.ok;
}

export interface FamilyChildInfo {
  inviterName: string;
  persons: ChildCandidate[];
}

/** Für die Seite hinter dem Link; null, wenn er nicht mehr gilt. */
export async function familyChildInfo(key: string, now: Date = new Date()): Promise<FamilyChildInfo | null> {
  const link = verifyFamilyChildKey(key, now);
  if (!link) return null;
  const inviter = await inviterOf(link.inviterId);
  if (!inviter || inviter.customerId === link.customerId) return null;
  const persons = childCandidates(await kontoRows(inviter.accountId, link.customerId), inviter.familyId, now);
  return { inviterName: memberName(inviter), persons };
}

/**
 * Bestätigen: die gewählten Personen des Kontos kommen als verwaltete
 * Mitglieder in die Familie der Einladenden (die Familie entsteht dabei,
 * wenn es noch keine gibt). Gibt die Zahl der neuen Mitglieder zurück.
 */
export async function confirmFamilyChildren(key: string, personIds: number[], now: Date = new Date()): Promise<number> {
  const link = verifyFamilyChildKey(key, now);
  const inviter = link ? await inviterOf(link.inviterId) : null;
  if (!link || !inviter || inviter.customerId === link.customerId) throw new FamilyError("Dieser Link gilt nicht mehr.");
  const wanted = new Set(personIds.slice(0, MAX_PERSONS));
  const persons = childCandidates(await kontoRows(inviter.accountId, link.customerId), inviter.familyId, now);
  const add = persons.filter((p) => !p.joined && wanted.has(p.id)).map((p) => p.id);
  if (add.length === 0) {
    if (persons.some((p) => p.joined && wanted.has(p.id))) return 0;
    throw new FamilyError("Bitte wähle mindestens eine Person aus.");
  }
  const familyId = await ensureFamily({
    id: inviter.id, accountId: inviter.accountId, familyId: inviter.familyId, familyAdult: inviter.familyAdult,
  });
  await assertRoom(familyId, inviter.accountId, add.length);
  const r = await prisma.riderProfile.updateMany({
    where: { id: { in: add }, accountId: inviter.accountId, customerId: link.customerId, familyId: null },
    data: { familyId, familyAdult: false },
  });
  return r.count;
}
