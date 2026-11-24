/**
 * Anmeldung an der Kunden-App per E-Mail.
 *
 * Der Kunde gibt auf `/app` nur seine Adresse ein und bekommt einen Link
 * (`/app/mail/<schlüssel>`, signiert, 48 Stunden gültig). Erst wenn er den Link
 * öffnet, ist die Adresse bestätigt.
 *
 * - Gehört die Adresse zu einem Kundenkonto (lib/customers), wählt der Kunde
 *   einmal, wer er ist: eine Person des Kontos oder „fahre selbst nicht“.
 *   Die übrigen Personen des Kontos ohne eigenen Zugang kommen als Familie
 *   dazu (`syncKontoFamily`), neue Abos des Kontos von selbst.
 * - Ohne Konto (noch nicht verknüpft) wie bisher: Abos mit dieser Adresse
 *   auswählen, ohne Abo geht es mit einem Profil ohne Ticket weiter.
 *
 * Tagestickets mit der Adresse kommen in beiden Fällen dazu.
 */
import { prisma } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { countLinked, dayTicketsByEmail, mailLinkKey, MAIL_LINK_HOURS, MAIL_MAX_PER_DAY, MAIL_PAUSE_MINUTES, normalizeEmail, DAY_GUEST_MAIL_SUBJECT } from "./day-guest";
import { newRiderToken } from "./rider-app";
import { samePersonAbos } from "./abo-person";
import { customerIdForEmail, kontoLogin, syncKontoFamily, type LoginPerson } from "./customers";
import { sendEmail } from "./email-sender";
import { riderLinkMail } from "./rider-mail-template";
import { equalsInsensitive } from "./like-escape";

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
  /** Ohne Konto: Abos mit dieser Adresse, die noch in keinem Profil sind. */
  abos: OnboardingAbo[];
  /** Konto zur Adresse, solange sich noch niemand damit angemeldet hat: Wer bist du? */
  konto: { persons: LoginPerson[]; guess: number | null } | null;
}

/** Profil, das diese Adresse bestätigt hat. */
async function confirmedProfile(accountId: number, email: string): Promise<{ id: number; token: string; email: string | null } | null> {
  return prisma.riderProfile.findFirst({
    where: { accountId, email },
    select: { id: true, token: true, email: true },
    orderBy: { id: "asc" },
  });
}

/** Ohne Konto: Profil über ein zugeordnetes Ticket mit dieser Adresse (aus der Zeit vor den Konten). */
async function profileViaTicket(accountId: number, email: string): Promise<{ id: number; token: string; email: string | null } | null> {
  const viaTicket = await prisma.ticket.findFirst({
    where: { accountId, riderProfileId: { not: null }, email: equalsInsensitive(email) },
    select: { email: true, riderProfile: { select: { id: true, token: true, email: true } } },
    orderBy: { id: "desc" },
  });
  // Zweite Sicherung neben dem maskierten Vergleich: Ein Profil gibt es nur
  // über ein Ticket, das genau diese Adresse trägt.
  if (!viaTicket || normalizeEmail(viaTicket.email) !== email) return null;
  return viaTicket.riderProfile ?? null;
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
      email: equalsInsensitive(email),
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
  const confirmed = await confirmedProfile(accountId, email);
  const konto = await kontoLogin(accountId, email, now);
  if (konto) {
    return { token: confirmed?.token ?? null, abos: [], konto: confirmed ? null : { persons: konto.persons, guess: konto.guess } };
  }
  const [viaTicket, abos] = await Promise.all([
    confirmed ? Promise.resolve(null) : profileViaTicket(accountId, email),
    openAbos(accountId, email, now),
  ]);
  return { token: (confirmed ?? viaTicket)?.token ?? null, abos, konto: null };
}

export interface OnboardingInput {
  /** Ohne Konto: gewählte Abos mit dieser Adresse. */
  ticketIds?: number[];
  /** Mit Konto: wer man ist; null = fährt selbst nicht. Fehlt es, gilt der Vorschlag. */
  personId?: number | null;
}

/**
 * Anmeldung abschließen. Mit Konto: die gewählte Person (oder eine neue ohne
 * Abo) bekommt die Adresse, die übrigen Personen kommen in ihre Familie.
 * Ohne Konto: Profil zur Adresse holen oder anlegen, die gewählten Abos (nur
 * solche mit dieser Adresse) und weitere Abo-Tickets derselben Person
 * zuordnen. Tagestickets der Adresse kommen dazu. Gibt den Token zurück.
 */
export async function completeOnboarding(
  accountId: number,
  email: string,
  input: OnboardingInput,
  now: Date = new Date(),
): Promise<string | null> {
  const config = await prisma.gamificationConfig.findUnique({ where: { accountId }, select: { enabled: true } });
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { isActive: true } });
  if (!config?.enabled || !account?.isActive) return null;

  const customerId = await customerIdForEmail(accountId, email);
  let profile = await confirmedProfile(accountId, email);
  if (customerId != null) {
    if (!profile) {
      // Wer bist du? Nur eine Person dieses Kontos ohne bestätigte Adresse
      // (mit Zugang nur der Kontoinhaber, siehe kontoLogin).
      const konto = await kontoLogin(accountId, email, now);
      const personId = input.personId === undefined ? konto?.guess ?? null : input.personId;
      if (personId != null && konto?.persons.some((p) => p.id === personId)) {
        const claimed = await prisma.riderProfile.updateMany({
          where: { id: personId, accountId, customerId, email: null },
          data: { email },
        });
        if (claimed.count === 1) {
          profile = await prisma.riderProfile.findUnique({ where: { id: personId }, select: { id: true, token: true, email: true } });
        }
      }
      if (!profile) {
        profile = await prisma.riderProfile.create({
          data: { token: newRiderToken(), accountId, email, customerId },
          select: { id: true, token: true, email: true },
        });
      }
    } else {
      // Profil aus der Zeit vor dem Konto: gehört jetzt dazu.
      await prisma.riderProfile.updateMany({ where: { id: profile.id, customerId: null }, data: { customerId } });
    }
    await adoptDay(accountId, email, profile.id, now);
    await syncKontoFamily(accountId, customerId);
    return profile.token;
  }

  // Ohne Konto: wie vor den Kundenkonten.
  const allowed = new Set((await openAbos(accountId, email, now)).map((a) => a.ticketId));
  const chosen = [...new Set(input.ticketIds ?? [])].filter((id) => allowed.has(id));
  if (!profile) profile = await profileViaTicket(accountId, email);
  if (!profile) {
    profile = await prisma.riderProfile.create({
      data: { token: newRiderToken(), accountId, email, customerId },
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
      select: { id: true, firstName: true, lastName: true, birthDate: true, startDate: true, endDate: true },
    });
    const ids = new Set(chosen);
    // Ältere Abo-Tickets derselben Person (Verlängerung) kommen mit. Gleicher
    // Name und Geburtsdatum genügt nicht: Auf einem anny-Familienkonto tragen
    // Eltern- und Kinder-Abo beide die Daten des Kontoinhabers. Laufen solche
    // Abos gleichzeitig, kommt nichts automatisch mit (lib/abo-person).
    const samePerson = tickets
      .filter((t) => t.firstName && t.lastName && t.birthDate)
      .map((t) => ({ firstName: t.firstName!, lastName: t.lastName!, birthDate: t.birthDate! }));
    if (samePerson.length > 0) {
      // Auch Abos in anderen Profilen zählen mit: sie verraten ein Familienkonto.
      const others = await prisma.ticket.findMany({
        where: { accountId, subscriptionId: { not: null }, id: { notIn: chosen }, OR: samePerson },
        select: { id: true, firstName: true, lastName: true, birthDate: true, startDate: true, endDate: true, riderProfileId: true },
        take: 50,
      });
      for (const t of tickets) {
        if (!t.firstName || !t.lastName || !t.birthDate) continue;
        const sameData = (o: { firstName: string | null; lastName: string | null; birthDate: Date | null }) =>
          o.firstName === t.firstName && o.lastName === t.lastName && o.birthDate?.getTime() === t.birthDate?.getTime();
        for (const o of samePersonAbos(tickets.filter(sameData), others.filter(sameData))) {
          if (o.riderProfileId == null) ids.add(o.id);
        }
      }
    }
    await prisma.ticket.updateMany({
      where: { accountId, subscriptionId: { not: null }, riderProfileId: null, id: { in: [...ids] } },
      data: { riderProfileId: profile.id, gamificationOptOut: false },
    });
  }

  await adoptDay(accountId, email, profile.id, now);
  return profile.token;
}

/** Tagestickets dieser Saison mit derselben Adresse ins Profil holen. */
async function adoptDay(accountId: number, email: string, profileId: number, now: Date): Promise<void> {
  const day = (await dayTicketsByEmail(accountId, email, now)).filter((t) => t.riderProfileId == null).map((t) => t.id);
  if (day.length === 0) return;
  await prisma.ticket.updateMany({
    where: { accountId, id: { in: day }, riderProfileId: null },
    data: { riderProfileId: profileId, gamificationOptOut: false },
  });
  await countLinked(accountId, day).catch((err) => console.error("[rider] count day tickets failed:", err));
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
          email: equalsInsensitive(email),
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
        to: equalsInsensitive(email),
        sentAt: { gte: new Date(now.getTime() - 86_400_000) },
      },
      select: { sentAt: true },
    });
    const pauseFrom = now.getTime() - MAIL_PAUSE_MINUTES * 60_000;
    if (recent.length >= MAIL_MAX_PER_DAY || recent.some((r) => r.sentAt.getTime() > pauseFrom)) continue;

    const url = `${origin}/app/mail/${mailLinkKey(target.accountId, email, now)}`;
    const content = riderLinkMail({ url, accountName: target.name, origin, hours: MAIL_LINK_HOURS });
    const result = await sendEmail({
      config: mail,
      to: email,
      subject: DAY_GUEST_MAIL_SUBJECT,
      html: content.html,
      text: content.text,
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
