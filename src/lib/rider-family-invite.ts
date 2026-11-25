/**
 * Per E-Mail in die App und die Familie einladen (Aaron, 20.11.2026: „hier
 * will ich leute per email direkt zur app einladen“).
 *
 * Eine Erwachsene der Familie gibt im Profil eine Adresse ein; dorthin geht
 * eine Mail im Look der App. Ihr Link ist der Anmelde-Link
 * (`/app/mail/<schlüssel>`, 7 Tage gültig, für Adressen mit eingerichtetem
 * Zugang eine Stunde) mit dem Einladungsschlüssel der
 * Familie (`?familie=<schlüssel>`): Wer ihn öffnet, belegt damit seine Adresse
 * und ist angemeldet (beim ersten Mal nach dem Einrichten). Der Familie tritt
 * die Person erst bei, wenn sie es auf der Einladungsseite per Knopf bestätigt:
 * Ein geöffneter Link allein ändert nichts, denn Postfächer rufen Links zum
 * Prüfen vorab ab. Bis dahin wartet der Schlüssel in einem Cookie, und die App
 * zeigt oben einen Hinweis auf die Einladung. Das Cookie nennt auch die
 * eingeladene Adresse: Der Hinweis erscheint nur bei der Person mit dieser
 * Adresse, nicht bei jemand anderem am selben Gerät.
 *
 * Kinder mit eigener Adresse holt weiter der Bestätigungslink
 * (lib/rider-family-link), Kinder ohne Adresse die Kasse (lib/rider-kasse-link).
 */
import { prisma } from "./prisma";
import { mailLinkKey, mailLinkTarget, MAIL_LINK_HOURS_WITH_ACCESS, normalizeEmail } from "./day-guest";
import { sendEmail } from "./email-sender";
import {
  FAMILY_INVITE_DAYS, FamilyError, assertRoom, ensureFamily, familyInviteInfo, familyInviteKey, familyInviteVersion, memberName,
  type FamilyPerson,
} from "./rider-family";
import { familyInviteMail } from "./rider-mail-template";
import { equalsInsensitive } from "./like-escape";
import { FAMILY_INVITE_MAIL_SUBJECT, openMailWithinCap } from "./rider-mail-cap";

export { FAMILY_INVITE_MAIL_SUBJECT };
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
  const key = familyInviteKey(familyId, viewer.id, now, await familyInviteVersion(familyId));
  // Hat die Adresse schon einen eigenen Zugang, meldet der Link nur eine Stunde
  // lang an; die Einladung selbst gilt weiter (lib/rider-family, /app/mail).
  const target = await mailLinkTarget(viewer.accountId, email);
  const hours = target.hasAccess ? MAIL_LINK_HOURS_WITH_ACCESS : FAMILY_INVITE_DAYS * 24;
  const url = `${origin}/app/mail/${mailLinkKey(viewer.accountId, email, now, hours, target.version)}?familie=${key}`;
  const content = familyInviteMail({ url, accountName: account.name, origin, inviterName: memberName(inviter), days: FAMILY_INVITE_DAYS });
  // Tagesgrenze je Konto (lib/rider-mail-cap): darüber nur an bekannte
  // Adressen. Die App bekommt dieselbe Antwort wie nach dem Senden.
  if (!(await openMailWithinCap(viewer.accountId, email, now))) return "sent";
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

/** Cookie-Wert: die eingeladene Adresse und der Schlüssel, durch ein Leerzeichen getrennt. */
export function familyInviteCookieValue(key: string, email: string): string {
  return `${email} ${key}`;
}

function parseFamilyInviteCookie(value: string | undefined): { email: string; key: string } | null {
  if (!value) return null;
  const at = value.indexOf(" ");
  if (at < 1 || at === value.length - 1) return null;
  return { email: value.slice(0, at), key: value.slice(at + 1) };
}

/**
 * Wartende Einladung für das Profil mit diesem Token, gelesen aus dem Cookie
 * (`familyInviteCookieValue`): gültig, vom selben Betrieb, an die Adresse
 * dieses Profils gegangen, und die Person ist noch keine Erwachsene dieser
 * Familie. Der Beitritt selbst läuft nur über den Knopf auf der
 * Einladungsseite (POST /api/rider/family/join) – ein geöffneter Link allein
 * ändert nichts.
 */
export async function pendingFamilyInvite(
  token: string,
  cookie: string | undefined,
): Promise<{ key: string; inviterName: string } | null> {
  const waiting = parseFamilyInviteCookie(cookie);
  if (!waiting) return null;
  const invite = await familyInviteInfo(waiting.key);
  if (!invite) return null;
  const p = await prisma.riderProfile.findUnique({
    where: { token },
    select: { accountId: true, email: true, familyId: true, familyAdult: true },
  });
  if (!p || p.accountId !== invite.accountId || p.email !== waiting.email) return null;
  if (p.familyId === invite.familyId && p.familyAdult) return null;
  return { key: waiting.key, inviterName: invite.inviterName };
}
