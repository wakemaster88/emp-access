/**
 * Passwort vergessen: Der Kunde lässt sich auf der Anmeldeseite einen Link an
 * die Adresse seines Zugangs schicken. Mit dem Link legt er ein neues
 * Passwort oder einen Passkey fest und ist danach angemeldet. Alle anderen
 * Sitzungen enden dabei (`sessionVersion` + 1), der Link gilt nur einmal.
 */
import { prisma } from "./prisma";
import { normalizeEmail } from "./day-guest";
import { sendEmail } from "./email-sender";
import { riderAppPath } from "./rider-app";
import { riderResetMail } from "./rider-mail-template";
import { RESET_LINK_MINUTES, signResetKey, verifyResetKey, type ResetKeyProfile } from "./rider-reset-key";

export const RESET_MAIL_SUBJECT = "Neues Passwort für die App";
const PAUSE_MINUTES = 5;
const MAX_PER_DAY = 5;

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

/**
 * Adresse, an die der Link geht: die bestätigte Adresse des Zugangs, sonst
 * die des Kundenkontos, sonst die am neuesten Ticket der Person.
 */
export async function resetEmailFor(profileId: number): Promise<string | null> {
  const p = await prisma.riderProfile.findUnique({
    where: { id: profileId },
    select: {
      email: true,
      customer: { select: { email: true } },
      tickets: { where: { email: { not: null } }, select: { email: true }, orderBy: { id: "desc" }, take: 1 },
    },
  });
  if (!p) return null;
  return normalizeEmail(p.email) ?? normalizeEmail(p.customer?.email) ?? normalizeEmail(p.tickets[0]?.email) ?? null;
}

export function riderResetKeyValid(p: ResetKeyProfile, key: unknown): boolean {
  return verifyResetKey(key, p, secret());
}

/**
 * Link schicken. Höchstens alle paar Minuten und wenige Male am Tag. Gibt
 * zurück, ob eine Mail rausging (der Aufrufer verrät das nicht weiter).
 */
export async function sendRiderResetMail(
  p: ResetKeyProfile & { accountId: number; token: string },
  origin: string,
  now: Date = new Date(),
): Promise<boolean> {
  const email = await resetEmailFor(p.id);
  if (!email || !secret()) return false;
  const [mail, account] = await Promise.all([
    prisma.emailConfig.findUnique({ where: { accountId: p.accountId } }),
    prisma.account.findUnique({ where: { id: p.accountId }, select: { name: true } }),
  ]);
  if (!mail || !mail.isActive || !mail.apiKey || !account) return false;

  const recent = await prisma.emailSend.findMany({
    where: {
      accountId: p.accountId,
      subject: RESET_MAIL_SUBJECT,
      to: { equals: email, mode: "insensitive" },
      sentAt: { gte: new Date(now.getTime() - 86_400_000) },
    },
    select: { sentAt: true },
  });
  const pauseFrom = now.getTime() - PAUSE_MINUTES * 60_000;
  if (recent.length >= MAX_PER_DAY || recent.some((r) => r.sentAt.getTime() > pauseFrom)) return false;

  const url = `${origin}${riderAppPath(p.token)}/neu/${signResetKey(p, secret(), now)}`;
  const content = riderResetMail({ url, accountName: account.name, origin, minutes: RESET_LINK_MINUTES });
  const result = await sendEmail({ config: mail, to: email, subject: RESET_MAIL_SUBJECT, html: content.html, text: content.text });
  await prisma.emailSend
    .create({
      data: {
        accountId: p.accountId,
        to: email,
        subject: RESET_MAIL_SUBJECT,
        status: result.ok ? "SENT" : "FAILED",
        errorMessage: result.ok ? null : (result.error ?? "Unbekannter Fehler").slice(0, 500),
      },
    })
    .catch(() => null);
  return result.ok;
}

/** Nach dem Zurücksetzen: alte Sitzungen beenden; liefert die neue Version fürs Cookie. */
export async function endOtherSessions(profileId: number): Promise<number> {
  const updated = await prisma.riderProfile.update({
    where: { id: profileId },
    data: { sessionVersion: { increment: 1 }, loginFailures: 0, loginLockedUntil: null },
    select: { sessionVersion: true },
  });
  return updated.sessionVersion;
}
