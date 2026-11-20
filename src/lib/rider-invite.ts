/**
 * Einladung zur Kunden-App, wenn über anny ein neues Abo gebucht wird.
 *
 * Der anny-Abgleich (lib/anny-sync) meldet jedes Abo, das er neu anlegt. Eine
 * Mail geht nur, wenn
 * - das Abo frisch ist (Beginn höchstens INVITE_FRESH_DAYS zurück), damit der
 *   erste Abgleich oder ein Nachholen alter Abos keine Massenmails auslöst,
 * - die Adresse noch kein anderes Abo hat (Bestandskunde, Verlängerung),
 * - unter der Adresse noch niemand in der App ist,
 * - die Adresse diese Einladung noch nie bekommen hat (Protokoll `EmailSend`),
 * - App, Mailversand und der Schalter „Einladung bei neuem Abo“
 *   (`GamificationConfig.inviteNewAbos`) eingeschaltet sind.
 * Je Lauf gehen höchstens INVITE_MAX_PER_RUN Mails raus.
 *
 * Bestandskunden: Mit dem Schalter „Einladung an Bestandskunden“
 * (`inviteExistingAbos`) bekommen laufende Abos, deren Adresse noch nicht in
 * der App ist und noch keine Einladung hatte, sie in Etappen über den Cron
 * tick-5min (`runInviteTick`): je Lauf EXISTING_PER_TICK Mails, nur 9–20 Uhr.
 *
 * Der Link ist der Anmelde-Link (`/app/mail/<schlüssel>`), nur länger gültig.
 */
import { prisma } from "./prisma";
import { mailLinkKey, normalizeEmail } from "./day-guest";
import { sendEmail } from "./email-sender";
import { riderInviteMail } from "./rider-mail-template";
import { berlinHour } from "./berlin-day";

export const INVITE_SUBJECT = "Dein Abo ist in der App";
export const INVITE_LINK_DAYS = 7;
export const INVITE_FRESH_DAYS = 7;
export const INVITE_MAX_PER_RUN = 25;
/** Bestandskunden: so viele Mails je 5-Minuten-Lauf und Konto. */
export const EXISTING_PER_TICK = 10;
/** Nach so vielen Fehlversuchen an eine Adresse nicht mehr versuchen. */
export const MAX_FAILED = 3;
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 20;

export interface NewAbo {
  ticketId: number;
  email: string | null;
  firstName: string | null;
  aboName: string | null;
  subscriptionId: number | null;
  startDate: Date | null;
  status: string;
}

/** Frisch gebucht: gültig und Beginn nicht älter als INVITE_FRESH_DAYS (künftiger Beginn zählt). */
export function isFreshAbo(abo: Pick<NewAbo, "status" | "startDate">, now: Date = new Date()): boolean {
  if (abo.status !== "VALID" || !abo.startDate) return false;
  return abo.startDate.getTime() >= now.getTime() - INVITE_FRESH_DAYS * 86_400_000;
}

/**
 * Wählt, wer eine Einladung bekommt: je Adresse das erste frische Abo, in der
 * Reihenfolge der Meldung. Gibt Adresse (klein) und das Abo für die Anrede zurück.
 */
export function inviteCandidates(abos: NewAbo[], allowedSubscriptionIds: number[], now: Date = new Date()): Array<{ email: string; abo: NewAbo }> {
  const seen = new Set<string>();
  const out: Array<{ email: string; abo: NewAbo }> = [];
  for (const abo of abos) {
    const email = normalizeEmail(abo.email);
    if (!email || seen.has(email)) continue;
    if (allowedSubscriptionIds.length > 0 && (abo.subscriptionId == null || !allowedSubscriptionIds.includes(abo.subscriptionId))) continue;
    if (!isFreshAbo(abo, now)) continue;
    seen.add(email);
    out.push({ email, abo });
  }
  return out;
}

/** Öffentliche Adresse der App für Links in Mails aus dem Hintergrund (kein Request). */
export function appOrigin(): string | null {
  const raw =
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return raw ? raw.replace(/\/$/, "") : null;
}

type MailConfig = NonNullable<Awaited<ReturnType<typeof prisma.emailConfig.findUnique>>>;

interface InviteContext {
  accountId: number;
  accountName: string;
  mail: MailConfig;
  origin: string;
  subscriptionIds: number[];
  inviteNewAbos: boolean;
  inviteExistingAbos: boolean;
}

/** Alles, was für eine Einladung eingeschaltet sein muss; sonst null. */
async function inviteContext(accountId: number): Promise<InviteContext | null> {
  const [config, account, mail] = await Promise.all([
    prisma.gamificationConfig.findUnique({
      where: { accountId },
      select: { enabled: true, subscriptionIds: true, inviteNewAbos: true, inviteExistingAbos: true },
    }),
    prisma.account.findUnique({ where: { id: accountId }, select: { isActive: true, name: true } }),
    prisma.emailConfig.findUnique({ where: { accountId } }),
  ]);
  if (!config?.enabled || !account?.isActive || !mail?.isActive || !mail.apiKey) return null;
  const origin = appOrigin();
  if (!origin) return null;
  return {
    accountId,
    accountName: account.name,
    mail,
    origin,
    subscriptionIds: config.subscriptionIds,
    inviteNewAbos: config.inviteNewAbos,
    inviteExistingAbos: config.inviteExistingAbos,
  };
}

/** Eine Einladung schicken und protokollieren. */
async function sendInvite(
  ctx: InviteContext,
  email: string,
  abo: Pick<NewAbo, "ticketId" | "firstName" | "aboName">,
  now: Date,
  send: typeof sendEmail,
): Promise<boolean> {
  const url = `${ctx.origin}/app/mail/${mailLinkKey(ctx.accountId, email, now, INVITE_LINK_DAYS * 24)}`;
  const content = riderInviteMail({
    url,
    accountName: ctx.accountName,
    origin: ctx.origin,
    days: INVITE_LINK_DAYS,
    firstName: abo.firstName,
    aboName: abo.aboName,
  });
  const result = await send({ config: ctx.mail, to: email, subject: content.subject, html: content.html, text: content.text });
  await prisma.emailSend
    .create({
      data: {
        accountId: ctx.accountId,
        ticketId: abo.ticketId,
        to: email,
        subject: INVITE_SUBJECT,
        status: result.ok ? "SENT" : "FAILED",
        errorMessage: result.ok ? null : (result.error ?? "Unbekannter Fehler").slice(0, 500),
      },
    })
    .catch(() => null);
  if (!result.ok) {
    console.error(`[rider invite] account=${ctx.accountId} Ticket ${abo.ticketId}: Einladung nicht verschickt: ${result.error ?? "unbekannt"}`);
  }
  return result.ok;
}

/** Adressen (klein), die schon in der App sind oder die Einladung bekommen haben bzw. zu oft scheiterte. */
async function excludedEmails(accountId: number): Promise<Set<string>> {
  const [profiles, linked, sends] = await Promise.all([
    prisma.riderProfile.findMany({ where: { accountId, email: { not: null } }, select: { email: true } }),
    prisma.ticket.findMany({
      where: { accountId, riderProfileId: { not: null }, email: { not: null } },
      select: { email: true },
      distinct: ["email"],
    }),
    prisma.emailSend.groupBy({ by: ["to", "status"], where: { accountId, subject: INVITE_SUBJECT }, _count: { _all: true } }),
  ]);
  const out = new Set<string>();
  for (const p of profiles) if (p.email) out.add(p.email.toLowerCase());
  for (const t of linked) if (t.email) out.add(t.email.trim().toLowerCase());
  for (const s of sends) {
    if (s.status === "SENT" || s._count._all >= MAX_FAILED) out.add(s.to.trim().toLowerCase());
  }
  return out;
}

/**
 * Einladungen für neu angelegte Abos verschicken. Gibt die Zahl der
 * verschickten Mails zurück. Fehler einzelner Mails bremsen nichts.
 */
export async function sendAboInvites(
  accountId: number,
  abos: NewAbo[],
  now: Date = new Date(),
  send: typeof sendEmail = sendEmail,
): Promise<number> {
  if (abos.length === 0) return 0;
  const ctx = await inviteContext(accountId);
  if (!ctx?.inviteNewAbos) return 0;

  const newIds = abos.map((a) => a.ticketId);
  const excluded = await excludedEmails(accountId);
  let sent = 0;
  for (const { email, abo } of inviteCandidates(abos, ctx.subscriptionIds, now)) {
    if (sent >= INVITE_MAX_PER_RUN) {
      console.warn(`[rider invite] account=${accountId} Obergrenze ${INVITE_MAX_PER_RUN} Einladungen je Lauf erreicht, Rest ausgelassen`);
      break;
    }
    if (excluded.has(email)) continue;
    const olderAbo = await prisma.ticket.count({
      where: { accountId, subscriptionId: { not: null }, email: { equals: email, mode: "insensitive" }, id: { notIn: newIds } },
    });
    if (olderAbo > 0) continue;
    if (await sendInvite(ctx, email, abo, now, send)) sent += 1;
  }
  if (sent > 0) console.log(`[rider invite] account=${accountId} ${sent} Einladung(en) zur App verschickt`);
  return sent;
}

/** Laufende Abos, deren Adresse noch eine Einladung bekommen kann: je Adresse das zuletzt endende. */
async function openExisting(accountId: number, subscriptionIds: number[], now: Date): Promise<Array<{ email: string; abo: NewAbo }>> {
  const rows = await prisma.ticket.findMany({
    where: {
      accountId,
      subscriptionId: subscriptionIds.length > 0 ? { in: subscriptionIds } : { not: null },
      status: { in: ["VALID", "PAUSED"] },
      email: { not: null },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
    select: { id: true, email: true, firstName: true, subscriptionId: true, startDate: true, status: true, subscription: { select: { name: true } } },
    orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { id: "asc" }],
    take: 5000,
  });
  const excluded = await excludedEmails(accountId);
  const seen = new Set<string>();
  const out: Array<{ email: string; abo: NewAbo }> = [];
  for (const t of rows) {
    const email = normalizeEmail(t.email);
    if (!email || seen.has(email) || excluded.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      abo: {
        ticketId: t.id,
        email,
        firstName: t.firstName,
        aboName: t.subscription?.name ?? null,
        subscriptionId: t.subscriptionId,
        startDate: t.startDate,
        status: t.status,
      },
    });
  }
  return out;
}

export interface InviteStatus {
  inviteNewAbos: boolean;
  inviteExistingAbos: boolean;
  /** Bisher verschickte Einladungen. */
  sent: number;
  /** Adressen laufender Abos, die noch eine Einladung bekommen würden. */
  openExisting: number;
  /** Was fehlt, damit Mails rausgehen können (Mailversand aus usw.); null = alles bereit. */
  blocker: string | null;
}

/** Stand für die Einstellungen im Backend. */
export async function inviteStatus(accountId: number, now: Date = new Date()): Promise<InviteStatus> {
  const [config, account, mail, sent] = await Promise.all([
    prisma.gamificationConfig.findUnique({
      where: { accountId },
      select: { enabled: true, subscriptionIds: true, inviteNewAbos: true, inviteExistingAbos: true },
    }),
    prisma.account.findUnique({ where: { id: accountId }, select: { isActive: true } }),
    prisma.emailConfig.findUnique({ where: { accountId }, select: { isActive: true, apiKey: true } }),
    prisma.emailSend.count({ where: { accountId, subject: INVITE_SUBJECT, status: "SENT" } }),
  ]);
  const blocker = !config?.enabled
    ? "Die Kunden-App ist aus."
    : !mail?.isActive || !mail.apiKey
      ? "Der Mailversand ist aus. Ihn schaltest du unter Einstellungen › E-Mail ein."
      : !account?.isActive || !appOrigin()
        ? "Die Adresse der App ist nicht bekannt."
        : null;
  return {
    inviteNewAbos: config?.inviteNewAbos ?? true,
    inviteExistingAbos: config?.inviteExistingAbos ?? false,
    sent,
    openExisting: (await openExisting(accountId, config?.subscriptionIds ?? [], now)).length,
    blocker,
  };
}

export interface InviteTickResult {
  accounts: number;
  sent: number;
}

/**
 * Cron tick-5min: Einladungen an Bestandskunden in Etappen, nur bei
 * eingeschaltetem Schalter und zwischen 9 und 20 Uhr (Berlin).
 */
export async function runInviteTick(now: Date = new Date(), send: typeof sendEmail = sendEmail): Promise<InviteTickResult> {
  const result: InviteTickResult = { accounts: 0, sent: 0 };
  const hour = berlinHour(now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return result;
  const configs = await prisma.gamificationConfig.findMany({
    where: { enabled: true, inviteExistingAbos: true },
    select: { accountId: true },
    take: 50,
  });
  for (const { accountId } of configs) {
    const ctx = await inviteContext(accountId);
    if (!ctx?.inviteExistingAbos) continue;
    result.accounts += 1;
    for (const { email, abo } of (await openExisting(accountId, ctx.subscriptionIds, now)).slice(0, EXISTING_PER_TICK)) {
      if (await sendInvite(ctx, email, abo, now, send)) result.sent += 1;
    }
  }
  return result;
}
