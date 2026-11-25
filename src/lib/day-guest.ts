/**
 * Tagesgäste in der Kunden-App. Verbindung ist die E-Mail-Adresse am Ticket:
 * sie kommt aus der Online-Buchung oder wird an der Kasse (Shop-Monitor) bzw.
 * im Backend eingetragen. Die Anmeldung per Mail-Link steht in
 * `rider-onboarding.ts`; hier liegen Mail-Schlüssel und das Zuordnen der
 * Tagestickets zum Profil.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma, tenantClient } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { buildScanCodeVariants } from "./scan-code-variants";
import { awardMilestones, loadGamiConfig, syncDayTicketStat } from "./gamification-service";
import { runChallenges } from "./challenge-service";
import { equalsInsensitive } from "./like-escape";
import { ticketIdsByEmail } from "./ticket-email";

const USABLE = ["VALID", "REDEEMED"] as const;
const MAX_TICKETS = 200;

/** Der Link in der Mail gilt so lange. */
export const MAIL_LINK_HOURS = 48;
/** So oft geht die Mail höchstens an dieselbe Adresse. */
export const MAIL_PAUSE_MINUTES = 10;
export const MAIL_MAX_PER_DAY = 5;
export const DAY_GUEST_MAIL_SUBJECT = "Dein Link zur App";

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

/** Adresse säubern (klein, ohne Leerraum); null, wenn sie keine gültige Adresse ist. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return v.length <= 180 && EMAIL_RE.test(v) ? v : null;
}

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`day-guest-mail:${payload}`).digest("base64url");
}

/** So lange gilt der Link, wenn das Profil zur Adresse schon ein Passwort oder einen Passkey hat. */
export const MAIL_LINK_HOURS_WITH_ACCESS = 1;

/**
 * Schlüssel im Mail-Link `/app/mail/<schlüssel>`: Konto, Adresse und Ablauf,
 * signiert. `version` ist die `sessionVersion` des Profils zur Adresse beim
 * Versand (`mailLinkTarget`): Steigt sie (Passwort geändert, „Auf allen
 * Geräten abmelden“), meldet der Link nicht mehr an (`mailLinkSession`).
 * Schlüssel ohne Version stammen aus der Zeit davor und gelten bis zu ihrem
 * Ablauf wie bisher.
 */
export function mailLinkKey(
  accountId: number,
  email: string,
  now: Date = new Date(),
  hours: number = MAIL_LINK_HOURS,
  version?: number,
): string {
  const data: { a: number; e: string; x: number; v?: number } = { a: accountId, e: email, x: now.getTime() + hours * 3_600_000 };
  if (version !== undefined) data.v = version;
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Profil, das die Adresse bestätigt hat (wie beim Einlösen des Links): seine
 * `sessionVersion` für den Schlüssel und ob es schon einen eigenen Zugang hat.
 * Ohne Profil Version 0, so starten neue Profile (`exists` false).
 */
export async function mailLinkTarget(
  accountId: number,
  email: string,
): Promise<{ version: number; hasAccess: boolean; exists: boolean }> {
  const p = await prisma.riderProfile.findFirst({
    where: { accountId, email },
    select: { sessionVersion: true, passwordHash: true, _count: { select: { passkeys: true } } },
    orderBy: { id: "asc" },
  });
  if (!p) return { version: 0, hasAccess: false, exists: false };
  return { version: p.sessionVersion, hasAccess: p.passwordHash != null || p._count.passkeys > 0, exists: true };
}

/**
 * Ist die Version im Link überholt? Nur wenn der Link eine trägt und es das
 * Profil zur Adresse gibt; dann muss sie dessen `sessionVersion` entsprechen.
 */
export function mailLinkStale(version: number | undefined, current: { version: number } | null): boolean {
  return version !== undefined && current !== null && current.version !== version;
}

/**
 * Wie `verifyMailLinkKey`, dazu die Version: Wurde seit dem Versand das
 * Passwort geändert, überall abgemeldet oder der Zugang zurückgesetzt, gilt
 * der Link nicht mehr (null), die Person fordert einen neuen an.
 */
export async function verifyCurrentMailLinkKey(
  value: string,
  now: Date = new Date(),
): Promise<{ accountId: number; email: string; version?: number } | null> {
  const link = verifyMailLinkKey(value, now);
  if (!link || link.version === undefined) return link;
  const target = await mailLinkTarget(link.accountId, link.email);
  return mailLinkStale(link.version, target.exists ? target : null) ? null : link;
}

export function verifyMailLinkKey(value: string, now: Date = new Date()): { accountId: number; email: string; version?: number } | null {
  const m = /^([A-Za-z0-9_-]{1,600})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m || !secret()) return null;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(sign(m[1]));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as { a?: unknown; e?: unknown; x?: unknown; v?: unknown };
    const email = normalizeEmail(data.e);
    if (typeof data.a !== "number" || typeof data.x !== "number" || !email || data.x < now.getTime()) return null;
    if (data.v === undefined) return { accountId: data.a, email };
    if (typeof data.v !== "number" || !Number.isInteger(data.v)) return null;
    return { accountId: data.a, email, version: data.v };
  } catch {
    return null;
  }
}

interface Candidate {
  id: number;
  riderProfileId: number | null;
  gamificationOptOut: boolean;
}

/** Tagestickets dieser Saison mit dieser Adresse, die in der App mitmachen dürfen. */
export async function dayTicketsByEmail(accountId: number, email: string, now: Date): Promise<Candidate[]> {
  const config = await loadGamiConfig(tenantClient(accountId), accountId);
  if (!config.enabled || config.dayServiceIds.length === 0) return [];
  const year = berlinYmd(now).slice(0, 4);
  const rows = await prisma.ticket.findMany({
    where: {
      accountId,
      subscriptionId: null,
      serviceId: { in: config.dayServiceIds },
      status: { in: [...USABLE] },
      email: equalsInsensitive(email),
    },
    select: { id: true, riderProfileId: true, gamificationOptOut: true, startDate: true, createdAt: true },
    orderBy: { id: "desc" },
    take: MAX_TICKETS,
  });
  return rows.filter((t) => berlinYmd(t.startDate ?? t.createdAt).startsWith(year));
}

/**
 * Wie `dayTicketsByEmail`, für das Zuordnen bei jedem Öffnen der App: die
 * Adresse wird über den Index gesucht (`ticketIdsByEmail`), dieselben Tickets.
 */
async function dayTicketsOf(accountId: number, ids: number[], dayServiceIds: number[], now: Date): Promise<Candidate[]> {
  if (ids.length === 0) return [];
  const year = berlinYmd(now).slice(0, 4);
  const rows = await prisma.ticket.findMany({
    where: {
      accountId,
      id: { in: ids },
      subscriptionId: null,
      serviceId: { in: dayServiceIds },
      status: { in: [...USABLE] },
    },
    select: { id: true, riderProfileId: true, gamificationOptOut: true, startDate: true, createdAt: true },
    orderBy: { id: "desc" },
    take: MAX_TICKETS,
  });
  return rows.filter((t) => berlinYmd(t.startDate ?? t.createdAt).startsWith(year));
}

/** Zugeordnete Tickets zählen: Tagessumme anlegen, Meilensteine und Challenges prüfen. */
export async function countLinked(accountId: number, ticketIds: number[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const db = tenantClient(accountId);
  const config = await loadGamiConfig(db, accountId);
  const today = berlinYmd(new Date());
  for (const id of ticketIds) await syncDayTicketStat(db, accountId, id);
  // Meilensteine zählen je Profil, ein Ticket genügt als Anker.
  await awardMilestones(db, accountId, ticketIds[0], today, config.startCapPerDay);
  for (const id of ticketIds) await runChallenges(db, accountId, id, today, config.startCapPerDay);
}

/**
 * Neue Tagestickets einer Adresse still zum vorhandenen Profil legen: nach dem
 * Scan am Drehkreuz, wenn die Kasse die Adresse einträgt und beim Öffnen der
 * App. Legt nie ein Profil an und fasst ausgestiegene Tickets nicht an.
 */
export async function adoptDayTickets(accountId: number, email: string | null | undefined, now: Date = new Date()): Promise<number> {
  const clean = normalizeEmail(email);
  if (!clean) return 0;
  const config = await loadGamiConfig(tenantClient(accountId), accountId);
  if (!config.enabled || config.dayServiceIds.length === 0) return 0;
  const ids = await ticketIdsByEmail(accountId, clean);
  const tickets = await dayTicketsOf(accountId, ids, config.dayServiceIds, now);
  const open = tickets.filter((t) => t.riderProfileId == null && !t.gamificationOptOut).map((t) => t.id);
  if (open.length === 0) return 0;
  const owner = tickets.find((t) => t.riderProfileId != null)
    ?? (await prisma.riderProfile.findFirst({
      where: { accountId, email: clean },
      select: { id: true },
      orderBy: { id: "asc" },
    }).then((p) => (p ? { riderProfileId: p.id } : null)))
    ?? (await prisma.ticket.findFirst({
      where: { accountId, id: { in: ids }, riderProfileId: { not: null } },
      select: { riderProfileId: true },
      orderBy: { id: "desc" },
    }));
  if (!owner?.riderProfileId) return 0;
  const linked = await prisma.ticket.updateMany({
    where: { accountId, id: { in: open }, riderProfileId: null, gamificationOptOut: false },
    data: { riderProfileId: owner.riderProfileId },
  });
  if (linked.count > 0) await countLinked(accountId, open);
  return linked.count;
}

/**
 * Die Adresse an Tagestickets wurde geändert (Shop-Monitor oder Backend).
 * `before` sind die Tickets mit ihrer alten Adresse. Ein Ticket, das über die
 * alte Adresse in einem Profil gelandet ist, verlässt es wieder (z. B. nach
 * einem Tippfehler). Gibt es zur neuen Adresse schon ein Profil, zählt es dort.
 */
export async function dayTicketEmailChanged(
  accountId: number,
  before: Array<{ id: number; email: string | null }>,
  newEmail: string | null,
): Promise<void> {
  const moved = before.filter((t) => t.email?.trim() && t.email.trim().toLowerCase() !== newEmail).map((t) => t.id);
  if (moved.length > 0) {
    const linked = await prisma.ticket.findMany({
      where: { accountId, id: { in: moved }, subscriptionId: null, riderProfileId: { not: null } },
      select: { id: true },
    });
    const ids = linked.map((t) => t.id);
    if (ids.length > 0) {
      await prisma.$transaction([
        prisma.riderDayStat.deleteMany({ where: { accountId, ticketId: { in: ids } } }),
        prisma.ticket.updateMany({ where: { accountId, id: { in: ids } }, data: { riderProfileId: null } }),
      ]);
    }
  }
  if (newEmail) await adoptDayTickets(accountId, newEmail);
}

/**
 * Tagesticket dieser Saison zu einem gescannten oder getippten Code finden
 * (Backend: Adresse zu einem Ticket eintragen). Armbänder und Karten werden
 * wieder ausgegeben, deshalb zählt bei ihnen nur das Ticket von heute.
 */
export async function findDayTicketByCode(code: string, accountId: number, now: Date = new Date()): Promise<{ id: number } | null> {
  const variants = buildScanCodeVariants(code);
  if (variants.length === 0) return null;
  const config = await loadGamiConfig(tenantClient(accountId), accountId);
  if (config.dayServiceIds.length === 0) return null;
  const today = berlinYmd(now);
  const candidates = await prisma.ticket.findMany({
    where: {
      accountId,
      subscriptionId: null,
      serviceId: { in: config.dayServiceIds },
      status: { in: [...USABLE] },
      OR: variants.flatMap((c) => [{ qrCode: c }, { barcode: c }, { rfidCode: c }]),
    },
    select: { id: true, qrCode: true, barcode: true, startDate: true, createdAt: true },
    orderBy: { id: "desc" },
    take: 50,
  });
  for (const t of candidates) {
    const day = berlinYmd(t.startDate ?? t.createdAt);
    const unique = variants.some((c) => c === t.qrCode || c === t.barcode);
    if (unique ? day.slice(0, 4) === today.slice(0, 4) : day === today) return { id: t.id };
  }
  return null;
}
