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

/** Schlüssel im Mail-Link `/app/mail/<schlüssel>`: Konto, Adresse und Ablauf, signiert. */
export function mailLinkKey(accountId: number, email: string, now: Date = new Date(), hours: number = MAIL_LINK_HOURS): string {
  const payload = Buffer.from(
    JSON.stringify({ a: accountId, e: email, x: now.getTime() + hours * 3_600_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyMailLinkKey(value: string, now: Date = new Date()): { accountId: number; email: string } | null {
  const m = /^([A-Za-z0-9_-]{1,600})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m || !secret()) return null;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(sign(m[1]));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as { a?: unknown; e?: unknown; x?: unknown };
    const email = normalizeEmail(data.e);
    if (typeof data.a !== "number" || typeof data.x !== "number" || !email || data.x < now.getTime()) return null;
    return { accountId: data.a, email };
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
      email: { equals: email, mode: "insensitive" },
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
  const tickets = await dayTicketsByEmail(accountId, clean, now);
  const open = tickets.filter((t) => t.riderProfileId == null && !t.gamificationOptOut).map((t) => t.id);
  if (open.length === 0) return 0;
  const owner = tickets.find((t) => t.riderProfileId != null)
    ?? (await prisma.riderProfile.findFirst({
      where: { accountId, email: clean },
      select: { id: true },
      orderBy: { id: "asc" },
    }).then((p) => (p ? { riderProfileId: p.id } : null)))
    ?? (await prisma.ticket.findFirst({
      where: { accountId, riderProfileId: { not: null }, email: { equals: clean, mode: "insensitive" } },
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
