/**
 * Anmeldung an der Kunden-App per E-Mail.
 *
 * Der Kunde gibt auf `/app` nur seine Adresse ein und bekommt einen Link
 * (`/app/mail/<schlüssel>`, signiert, 48 Stunden gültig). Erst wenn er den Link
 * öffnet, ist die Adresse bestätigt: Das System sucht Abos mit dieser Adresse,
 * der Kunde wählt seine aus und landet in seinem Profil. Ohne Abo geht es mit
 * einem Profil ohne Ticket weiter (Abo dann in der App buchbar). Tagestickets
 * mit der Adresse kommen wie bisher automatisch dazu.
 */
import { prisma } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { countLinked, dayTicketsByEmail, mailLinkKey, MAIL_LINK_HOURS, MAIL_MAX_PER_DAY, MAIL_PAUSE_MINUTES, normalizeEmail, DAY_GUEST_MAIL_SUBJECT } from "./day-guest";
import { newRiderToken } from "./rider-app";
import { sendEmail } from "./email-sender";
import { escapeHtml, wrapEmailHtml } from "./email-templates";

const ABO_STATUS = ["VALID", "REDEEMED", "PAUSED"] as const;
const MAX_ABOS = 20;

export interface OnboardingAbo {
  ticketId: number;
  /** Name der Person am Abo (Vorname Nachname). */
  holder: string;
  aboName: string;
  endDate: Date | null;
  birthYear: number | null;
}

export interface OnboardingState {
  /** Vorhandenes Profil zu dieser Adresse (Token), sonst null. */
  token: string | null;
  /** Abos mit dieser Adresse, die noch in keinem Profil sind. */
  abos: OnboardingAbo[];
}

/** Profil zu einer bestätigten Adresse: am Profil selbst oder über ein zugeordnetes Ticket. */
async function profileByEmail(accountId: number, email: string): Promise<{ id: number; token: string; email: string | null } | null> {
  const direct = await prisma.riderProfile.findFirst({
    where: { accountId, email },
    select: { id: true, token: true, email: true },
    orderBy: { id: "asc" },
  });
  if (direct) return direct;
  const viaTicket = await prisma.ticket.findFirst({
    where: { accountId, riderProfileId: { not: null }, email: { equals: email, mode: "insensitive" } },
    select: { riderProfile: { select: { id: true, token: true, email: true } } },
    orderBy: { id: "desc" },
  });
  return viaTicket?.riderProfile ?? null;
}

/** Abos mit dieser Adresse, die noch niemand in die App geholt hat. */
async function openAbos(accountId: number, email: string, now: Date): Promise<OnboardingAbo[]> {
  const config = await prisma.gamificationConfig.findUnique({ where: { accountId }, select: { subscriptionIds: true } });
  const rows = await prisma.ticket.findMany({
    where: {
      accountId,
      subscriptionId: config?.subscriptionIds.length ? { in: config.subscriptionIds } : { not: null },
      riderProfileId: null,
      status: { in: [...ABO_STATUS] },
      email: { equals: email, mode: "insensitive" },
      OR: [{ endDate: null }, { endDate: { gte: new Date(now.getTime() - 365 * 86_400_000) } }],
    },
    select: {
      id: true, name: true, firstName: true, lastName: true, birthDate: true, endDate: true,
      subscription: { select: { name: true } },
    },
    orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { id: "desc" }],
    take: MAX_ABOS,
  });
  return rows.map((t) => ({
    ticketId: t.id,
    holder: [t.firstName, t.lastName].filter(Boolean).join(" ").trim() || t.name,
    aboName: t.subscription?.name ?? "Abo",
    endDate: t.endDate,
    birthYear: t.birthDate ? t.birthDate.getUTCFullYear() : null,
  }));
}

/** Was der Kunde nach dem Öffnen des Mail-Links sieht. */
export async function onboardingState(accountId: number, email: string, now: Date = new Date()): Promise<OnboardingState> {
  const [profile, abos] = await Promise.all([profileByEmail(accountId, email), openAbos(accountId, email, now)]);
  return { token: profile?.token ?? null, abos };
}

/**
 * Anmeldung abschließen: Profil zur Adresse holen oder anlegen, die gewählten
 * Abos (nur solche mit dieser Adresse) und weitere Abo-Tickets derselben
 * Person zuordnen, Tagestickets der Adresse dazu. Gibt den Token zurück.
 */
export async function completeOnboarding(
  accountId: number,
  email: string,
  ticketIds: number[],
  now: Date = new Date(),
): Promise<string | null> {
  const config = await prisma.gamificationConfig.findUnique({ where: { accountId }, select: { enabled: true } });
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { isActive: true } });
  if (!config?.enabled || !account?.isActive) return null;

  const allowed = new Set((await openAbos(accountId, email, now)).map((a) => a.ticketId));
  const chosen = [...new Set(ticketIds)].filter((id) => allowed.has(id));

  let profile = await profileByEmail(accountId, email);
  if (!profile) {
    profile = await prisma.riderProfile.create({
      data: { token: newRiderToken(), accountId, email },
      select: { id: true, token: true, email: true },
    });
  } else if (profile.email == null) {
    // Die Adresse gehört einem anderen Profil? Dann nicht doppelt vergeben.
    const taken = await prisma.riderProfile.count({ where: { accountId, email, id: { not: profile.id } } });
    if (taken === 0) await prisma.riderProfile.update({ where: { id: profile.id }, data: { email } });
  }

  if (chosen.length > 0) {
    const tickets = await prisma.ticket.findMany({
      where: { accountId, id: { in: chosen } },
      select: { id: true, firstName: true, lastName: true, birthDate: true },
    });
    // Ältere Abo-Tickets derselben Person (Verlängerung) kommen mit.
    const samePerson = tickets
      .filter((t) => t.firstName && t.lastName && t.birthDate)
      .map((t) => ({ firstName: t.firstName!, lastName: t.lastName!, birthDate: t.birthDate! }));
    await prisma.ticket.updateMany({
      where: {
        accountId,
        subscriptionId: { not: null },
        riderProfileId: null,
        OR: [{ id: { in: chosen } }, ...samePerson],
      },
      data: { riderProfileId: profile.id, gamificationOptOut: false },
    });
  }

  // Tagestickets dieser Saison mit derselben Adresse.
  const day = (await dayTicketsByEmail(accountId, email, now)).filter((t) => t.riderProfileId == null).map((t) => t.id);
  if (day.length > 0) {
    await prisma.ticket.updateMany({
      where: { accountId, id: { in: day }, riderProfileId: null },
      data: { riderProfileId: profile.id, gamificationOptOut: false },
    });
    await countLinked(accountId, day).catch((err) => console.error("[rider] count day tickets failed:", err));
  }
  return profile.token;
}

/** Konten, für die eine Adresse einen Link bekommt. */
async function targetAccounts(email: string, now: Date): Promise<Array<{ accountId: number; name: string }>> {
  const configs = await prisma.gamificationConfig.findMany({
    where: { enabled: true, account: { isActive: true } },
    select: { accountId: true, account: { select: { name: true } } },
    take: 50,
  });
  const known: Array<{ accountId: number; name: string }> = [];
  for (const c of configs) {
    const hit =
      (await prisma.riderProfile.count({ where: { accountId: c.accountId, email } })) > 0 ||
      (await prisma.ticket.count({
        where: {
          accountId: c.accountId,
          email: { equals: email, mode: "insensitive" },
          OR: [{ subscriptionId: { not: null } }, { riderProfileId: { not: null } }],
        },
      })) > 0 ||
      (await dayTicketsByEmail(c.accountId, email, now)).length > 0;
    if (hit) known.push({ accountId: c.accountId, name: c.account.name });
  }
  if (known.length > 0) return known;
  // Neue Kunden ohne Abo und Ticket: nur eindeutig, wenn genau ein Betrieb die App anbietet.
  return configs.length === 1 ? [{ accountId: configs[0].accountId, name: configs[0].account.name }] : [];
}

/**
 * Link zur App anfordern. Schickt je passendem Konto eine Mail an genau diese
 * Adresse, höchstens alle paar Minuten und wenige Male am Tag. Verrät dem
 * Aufrufer nicht, ob es die Adresse gibt. Gibt die Zahl der Mails zurück.
 */
export async function requestAppLink(rawEmail: unknown, origin: string, now: Date = new Date()): Promise<number> {
  const email = normalizeEmail(rawEmail);
  if (!email) return 0;
  let sent = 0;
  for (const target of await targetAccounts(email, now)) {
    const mail = await prisma.emailConfig.findUnique({ where: { accountId: target.accountId } });
    if (!mail || !mail.isActive || !mail.apiKey) continue;
    const recent = await prisma.emailSend.findMany({
      where: {
        accountId: target.accountId,
        subject: DAY_GUEST_MAIL_SUBJECT,
        to: { equals: email, mode: "insensitive" },
        sentAt: { gte: new Date(now.getTime() - 86_400_000) },
      },
      select: { sentAt: true },
    });
    const pauseFrom = now.getTime() - MAIL_PAUSE_MINUTES * 60_000;
    if (recent.length >= MAIL_MAX_PER_DAY || recent.some((r) => r.sentAt.getTime() > pauseFrom)) continue;

    const url = `${origin}/app/mail/${mailLinkKey(target.accountId, email, now)}`;
    const name = target.name;
    const innerHtml = [
      `<p style="margin:0 0 16px;">Hallo,</p>`,
      `<p style="margin:0 0 16px;">hier ist dein Link zur App von ${escapeHtml(name)}. Dort siehst du dein Abo, deine Besuche, Ziele und Gutscheine.</p>`,
      `<p style="margin:0 0 20px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:${escapeHtml(mail.brandColor || "#236770")};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;">App öffnen</a></p>`,
      `<p style="margin:0 0 16px;">Der Link gilt ${MAIL_LINK_HOURS} Stunden. Beim ersten Öffnen wählst du dein Abo aus und richtest einen Passkey oder ein Passwort ein.</p>`,
      `<p style="margin:0;color:#6b6862;font-size:13.5px;">Du hast nichts angefordert? Dann musst du nichts tun, ohne Klick passiert nichts.</p>`,
    ].join("\n");
    const text = [
      "Hallo,",
      "",
      `hier ist dein Link zur App von ${name}. Dort siehst du dein Abo, deine Besuche, Ziele und Gutscheine.`,
      "",
      url,
      "",
      `Der Link gilt ${MAIL_LINK_HOURS} Stunden. Beim ersten Öffnen wählst du dein Abo aus und richtest einen Passkey oder ein Passwort ein.`,
      "",
      "Du hast nichts angefordert? Dann musst du nichts tun, ohne Klick passiert nichts.",
    ].join("\n");
    const result = await sendEmail({
      config: mail,
      to: email,
      subject: DAY_GUEST_MAIL_SUBJECT,
      html: wrapEmailHtml({
        innerHtml,
        brandColor: mail.brandColor,
        logoUrl: mail.logoUrl,
        websiteUrl: mail.websiteUrl,
        accountName: name,
        preheader: "Dein persönlicher Link zur App",
      }),
      text,
    });
    await prisma.emailSend
      .create({
        data: {
          accountId: target.accountId,
          to: email,
          subject: DAY_GUEST_MAIL_SUBJECT,
          status: result.ok ? "SENT" : "FAILED",
          errorMessage: result.ok ? null : (result.error ?? "Unbekannter Fehler").slice(0, 500),
        },
      })
      .catch(() => null);
    if (result.ok) sent += 1;
  }
  return sent;
}

/** Laufzeit-Text für die Auswahl („bis 31.12.2026“, „abgelaufen“). */
export function aboRuntimeLabel(endDate: Date | null, now: Date = new Date()): string {
  if (!endDate) return "ohne Enddatum";
  const [y, m, d] = berlinYmd(endDate).split("-");
  return endDate.getTime() < now.getTime() ? `abgelaufen am ${d}.${m}.${y}` : `bis ${d}.${m}.${y}`;
}
