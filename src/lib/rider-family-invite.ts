/**
 * Per E-Mail in die App und die Familie einladen (Aaron, 20.11.2026: „hier
 * will ich leute per email direkt zur app einladen“).
 *
 * Eine Erwachsene der Familie gibt im Profil eine Adresse ein; dorthin geht
 * eine Mail im Look der App. Ihr Link ist der Anmelde-Link
 * (`/app/mail/<schlüssel>`, 7 Tage gültig) mit dem Einladungsschlüssel der
 * Familie (`?familie=<schlüssel>`): Wer ihn öffnet, belegt damit seine Adresse
 * und ist angemeldet (beim ersten Mal nach dem Einrichten). Der Familie tritt
 * die Person erst bei, wenn sie es auf der Einladungsseite per Knopf bestätigt:
 * Ein geöffneter Link allein ändert nichts, denn Postfächer rufen Links zum
 * Prüfen vorab ab. Bis dahin wartet der Schlüssel in einem Cookie, und die App
 * zeigt oben einen Hinweis auf die Einladung.
 *
 * Kinder mit eigener Adresse holt weiter der Bestätigungslink
 * (lib/rider-family-link), Kinder ohne Adresse die Kasse (lib/rider-kasse-link).
 */
import { prisma } from "./prisma";
import { mailLinkKey, normalizeEmail } from "./day-guest";
import { sendEmail } from "./email-sender";
import {
  FAMILY_INVITE_DAYS, FamilyError, assertRoom, ensureFamily, familyInviteInfo, familyInviteKey, memberName,
  type FamilyPerson,
} from "./rider-family";
import { familyInviteMail } from "./rider-mail-template";
import { equalsInsensitive } from "./like-escape";

export const FAMILY_INVITE_MAIL_SUBJECT = "Einladung in die App";
/** Cookie, in dem der Schlüssel bis zum Ende der Anmeldung wartet. */
export const FAMILY_INVITE_COOKIE = "rd-family-invite";
const PAUSE_MINUTES = 10;
const MAX_PER_ADDRESS_DAY = 3;

export type InviteResult = "sent" | "member";

/**
 * Einladung schicken. Wirft `FamilyError` mit Text für die App. „member“: die
 * Adresse gehört schon zu dieser Familie, es geht keine Mail raus.
 */
export async function inviteFamilyByMail(
  viewer: FamilyPerson & { email: string | null },
  rawEmail: unknown,
  origin: string,
  now: Date = new Date(),
  send: typeof sendEmail = sendEmail,
): Promise<InviteResult> {
  if (viewer.familyId != null && !viewer.familyAdult) throw new FamilyError("Nur Erwachsene der Familie können einladen.");
  const email = normalizeEmail(rawEmail);
  if (!email) throw new FamilyError("Bitte gib eine gültige E-Mail-Adresse ein.");
  if (viewer.email && email === viewer.email) throw new FamilyError("Das ist deine eigene Adresse.");

  if (viewer.familyId != null) {
    const member = await prisma.riderProfile.count({ where: { accountId: viewer.accountId, familyId: viewer.familyId, email } });
    if (member > 0) return "member";
    await assertRoom(viewer.familyId, viewer.accountId, 1);
  }

  const [mail, account, inviter] = await Promise.all([
    prisma.emailConfig.findUnique({ where: { accountId: viewer.accountId } }),
    prisma.account.findUnique({ where: { id: viewer.accountId }, select: { name: true } }),
    prisma.riderProfile.findUnique({
      where: { id: viewer.id },
      select: { firstName: true, nickname: true, tickets: { select: { firstName: true, name: true, endDate: true, subscriptionId: true }, orderBy: { id: "desc" }, take: 20 } },
    }),
  ]);
  if (!mail || !mail.isActive || !mail.apiKey || !account || !inviter) {
    throw new FamilyError("Mails sind gerade nicht eingerichtet. Teile stattdessen den Einladungslink.");
  }

  // Je Adresse höchstens alle paar Minuten und wenige Male am Tag (je
  // einladender Person begrenzt die API).
  const toAddress = await prisma.emailSend.findMany({
    where: {
      accountId: viewer.accountId,
      subject: FAMILY_INVITE_MAIL_SUBJECT,
      to: equalsInsensitive(email),
      sentAt: { gte: new Date(now.getTime() - 86_400_000) },
    },
    select: { sentAt: true },
  });
  const pauseFrom = now.getTime() - PAUSE_MINUTES * 60_000;
  if (toAddress.some((r) => r.sentAt.getTime() > pauseFrom)) {
    throw new FamilyError(`An diese Adresse ging gerade schon eine Einladung. Bitte warte ${PAUSE_MINUTES} Minuten.`);
  }
  if (toAddress.length >= MAX_PER_ADDRESS_DAY) {
    throw new FamilyError("An diese Adresse sind heute genug Einladungen unterwegs. Versuch es morgen noch einmal.");
  }

  const familyId = await ensureFamily(viewer);
  const key = familyInviteKey(familyId, viewer.id, now);
  const url = `${origin}/app/mail/${mailLinkKey(viewer.accountId, email, now, FAMILY_INVITE_DAYS * 24)}?familie=${key}`;
  const content = familyInviteMail({ url, accountName: account.name, origin, inviterName: memberName(inviter), days: FAMILY_INVITE_DAYS });
  const result = await send({ config: mail, to: email, subject: content.subject, html: content.html, text: content.text });
  await prisma.emailSend
    .create({
      data: {
        accountId: viewer.accountId,
        to: email,
        subject: FAMILY_INVITE_MAIL_SUBJECT,
        status: result.ok ? "SENT" : "FAILED",
        errorMessage: result.ok ? null : (result.error ?? "Unbekannter Fehler").slice(0, 500),
      },
    })
    .catch(() => null);
  if (!result.ok) throw new FamilyError("Die Einladung ließ sich gerade nicht verschicken. Bitte versuch es später noch einmal.");
  console.log(`[rider family] account=${viewer.accountId} Einladung per Mail von ${viewer.id}`);
  return "sent";
}

/** Cookie mit dem Einladungsschlüssel: gilt einen Tag, nur für den Server lesbar. */
export function familyInviteCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 86_400 };
}

/**
 * Wartende Einladung für das Profil mit diesem Token: gültig, vom selben
 * Betrieb, und die Person ist noch keine Erwachsene dieser Familie. Der
 * Beitritt selbst läuft nur über den Knopf auf der Einladungsseite
 * (POST /api/rider/family/join) – ein geöffneter Link allein ändert nichts.
 */
export async function pendingFamilyInvite(
  token: string,
  key: string | undefined,
): Promise<{ key: string; inviterName: string } | null> {
  if (!key) return null;
  const invite = await familyInviteInfo(key);
  if (!invite) return null;
  const p = await prisma.riderProfile.findUnique({
    where: { token },
    select: { accountId: true, familyId: true, familyAdult: true },
  });
  if (!p || p.accountId !== invite.accountId) return null;
  if (p.familyId === invite.familyId && p.familyAdult) return null;
  return { key, inviterName: invite.inviterName };
}
