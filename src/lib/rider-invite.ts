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
 * - App und Mailversand des Betriebs eingeschaltet sind.
 * Je Lauf gehen höchstens INVITE_MAX_PER_RUN Mails raus.
 *
 * Der Link ist der Anmelde-Link (`/app/mail/<schlüssel>`), nur länger gültig.
 */
import { prisma } from "./prisma";
import { mailLinkKey, normalizeEmail } from "./day-guest";
import { sendEmail } from "./email-sender";
import { riderInviteMail } from "./rider-mail-template";

export const INVITE_SUBJECT = "Dein Abo ist in der App";
export const INVITE_LINK_DAYS = 7;
export const INVITE_FRESH_DAYS = 7;
export const INVITE_MAX_PER_RUN = 25;

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
  const [config, account, mail] = await Promise.all([
    prisma.gamificationConfig.findUnique({ where: { accountId }, select: { enabled: true, subscriptionIds: true } }),
    prisma.account.findUnique({ where: { id: accountId }, select: { isActive: true, name: true } }),
    prisma.emailConfig.findUnique({ where: { accountId } }),
  ]);
  if (!config?.enabled || !account?.isActive || !mail?.isActive || !mail.apiKey) return 0;
  const origin = appOrigin();
  if (!origin) return 0;

  const newIds = abos.map((a) => a.ticketId);
  let sent = 0;
  for (const { email, abo } of inviteCandidates(abos, config.subscriptionIds, now)) {
    if (sent >= INVITE_MAX_PER_RUN) {
      console.warn(`[rider invite] account=${accountId} Obergrenze ${INVITE_MAX_PER_RUN} Einladungen je Lauf erreicht, Rest ausgelassen`);
      break;
    }
    const insensitive = { equals: email, mode: "insensitive" as const };
    const [olderAbo, inApp, invited] = await Promise.all([
      prisma.ticket.count({ where: { accountId, subscriptionId: { not: null }, email: insensitive, id: { notIn: newIds } } }),
      prisma.riderProfile.count({ where: { accountId, email } }).then(async (n) =>
        n > 0 ? n : prisma.ticket.count({ where: { accountId, email: insensitive, riderProfileId: { not: null } } }),
      ),
      prisma.emailSend.count({ where: { accountId, subject: INVITE_SUBJECT, to: insensitive, status: "SENT" } }),
    ]);
    if (olderAbo > 0 || inApp > 0 || invited > 0) continue;

    const url = `${origin}/app/mail/${mailLinkKey(accountId, email, now, INVITE_LINK_DAYS * 24)}`;
    const content = riderInviteMail({
      url,
      accountName: account.name,
      origin,
      days: INVITE_LINK_DAYS,
      firstName: abo.firstName,
      aboName: abo.aboName,
    });
    const result = await send({ config: mail, to: email, subject: content.subject, html: content.html, text: content.text });
    await prisma.emailSend
      .create({
        data: {
          accountId,
          ticketId: abo.ticketId,
          to: email,
          subject: INVITE_SUBJECT,
          status: result.ok ? "SENT" : "FAILED",
          errorMessage: result.ok ? null : (result.error ?? "Unbekannter Fehler").slice(0, 500),
        },
      })
      .catch(() => null);
    if (result.ok) sent += 1;
    else console.error(`[rider invite] account=${accountId} Ticket ${abo.ticketId}: Einladung nicht verschickt: ${result.error ?? "unbekannt"}`);
  }
  if (sent > 0) console.log(`[rider invite] account=${accountId} ${sent} Einladung(en) zur App verschickt`);
  return sent;
}
