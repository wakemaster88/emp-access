/**
 * Tagesobergrenze je Konto für die App-Mails, die jemand von außen für eine
 * eingegebene Adresse auslöst: der Link zur App (`/app`, Kasse) und die
 * Einladung in die Familie. Gezählt wird in `EmailSend` ab Mitternacht
 * (Europe/Berlin). Bis zur Grenze geht jede Mail raus wie bisher; darüber nur
 * noch an Adressen, zu denen es im Konto schon ein Ticket oder ein Profil
 * gibt. Was der Aufrufer zurückbekommt, ändert sich dadurch nicht.
 *
 * Mails, die das System von sich aus schickt (Einladung zu einem neuen Abo,
 * Passwort zurücksetzen), laufen hier nicht durch.
 */
import { prisma } from "./prisma";
import { berlinDayStart } from "./berlin-day";
import { DAY_GUEST_MAIL_SUBJECT } from "./day-guest";
import { equalsInsensitive } from "./like-escape";

/** Betreff der Familien-Einladung (lib/rider-family-invite). */
export const FAMILY_INVITE_MAIL_SUBJECT = "Einladung in die App";

/** Höchstens so viele dieser Mails je Konto und Tag an Adressen ohne Ticket und Profil. */
export const OPEN_MAIL_DAY_CAP = 300;

/** Betreffzeilen, die zur Grenze zählen. */
export const OPEN_MAIL_SUBJECTS: readonly string[] = [DAY_GUEST_MAIL_SUBJECT, FAMILY_INVITE_MAIL_SUBJECT];

/** Darf die Mail raus? Unter der Grenze immer, darüber nur an bekannte Adressen. */
export function openMailAllowed(sentToday: number, knownAddress: boolean): boolean {
  return sentToday < OPEN_MAIL_DAY_CAP || knownAddress;
}

/** Gibt es im Konto schon ein Profil oder ein Ticket mit dieser Adresse? */
async function addressKnown(accountId: number, email: string): Promise<boolean> {
  const profiles = await prisma.riderProfile.count({ where: { accountId, email } });
  if (profiles > 0) return true;
  const tickets = await prisma.ticket.count({ where: { accountId, email: equalsInsensitive(email) } });
  return tickets > 0;
}

/**
 * Prüft die Tagesgrenze für eine Mail an `email`. Zählt erst, und sucht die
 * Adresse nur, wenn die Grenze erreicht ist.
 */
export async function openMailWithinCap(accountId: number, email: string, now: Date = new Date()): Promise<boolean> {
  const sentToday = await prisma.emailSend.count({
    where: { accountId, subject: { in: [...OPEN_MAIL_SUBJECTS] }, sentAt: { gte: berlinDayStart(now) } },
  });
  if (openMailAllowed(sentToday, false)) return true;
  const known = await addressKnown(accountId, email);
  if (!openMailAllowed(sentToday, known)) console.warn(`[rider mail] account=${accountId} Tagesgrenze für App-Mails erreicht, Mail an unbekannte Adresse nicht gesendet`);
  return known;
}
