/**
 * Push an alle Kunden der App, wenn ein neues Angebot, eine News oder eine neue
 * Challenge veröffentlicht wird oder ein Feiertag in der App erscheint. Die Verwaltung setzt beim Anlegen den
 * Schalter „Push senden“ (`pushPlanned`); gesendet wird genau einmal
 * (`pushedAt`), sobald der Eintrag für Kunden sichtbar ist und es Tag ist.
 * Läuft direkt nach dem Speichern und im 5-Minuten-Cron für geplante Einträge.
 * Versand in Blöcken (`push-blocks.ts`); eine Meldung startet nur, wenn sie
 * auch im ungünstigsten Fall in der verbleibenden Zeit des Laufs fertig wird,
 * sonst übernimmt sie der nächste Cron-Lauf.
 *
 * Empfänger sind nur Geräte, auf denen ein Kunde Benachrichtigungen selbst
 * eingeschaltet hat (`RiderPushSubscription`). Ohne VAPID-Keys (lokal, Tests)
 * geht nichts raus.
 */
import { prisma } from "./prisma";
import { berlinHour, berlinYmd } from "./berlin-day";
import { currentHoliday } from "./holidays";
import { dbDateToYmd, type ChallengeKind, type GamiMetric } from "./gamification";
import { riderAppPath } from "./rider-app";
import { deliverPush, isWebPushConfigured, type PushTarget } from "./web-push";
import { chunk, pushFitsBudget } from "./push-blocks";
import { birthdayPushAccounts, runBirthdayPushes } from "./rider-birthday";
import { audienceMatches, passKindOf, type PassConfig } from "./rider-pass";
import {
  challengeAnnounceBlock,
  challengePushText,
  holidayAnnounceBlock,
  holidayPushText,
  offerAnnounceBlock,
  offerPushText,
  type AnnounceText,
} from "./rider-announce-rules";

/** Wie viele Kunden und Geräte ein Push erreichen würde. */
export async function riderPushReach(accountId: number): Promise<{ devices: number; riders: number }> {
  const subs = await prisma.riderPushSubscription.findMany({ where: { accountId }, select: { profileId: true } });
  return { devices: subs.length, riders: new Set(subs.map((s) => s.profileId)).size };
}

/** Zeit für Meldungen direkt nach dem Speichern (Route mit maxDuration 60). */
const ROUTE_BUDGET_MS = 45_000;
/** Zeit für Meldungen im 5-Minuten-Cron (maxDuration 120). */
const CRON_BUDGET_MS = 90_000;

type RiderTargets = { token: string; subs: PushTarget[] }[];

/**
 * Empfänger: jedes Gerät mit Push-Erlaubnis, je Kunde gebündelt. Mit
 * `audience` nur Personen mit dem passenden Pass (Ride Pass, Beach Pass oder
 * beide).
 */
async function riderTargets(accountId: number, audience?: { audience: string; config: PassConfig }): Promise<RiderTargets> {
  const all = await prisma.riderPushSubscription.findMany({
    where: { accountId },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      profile: { select: { token: true, tickets: { select: { subscriptionId: true, status: true, endDate: true } } } },
    },
  });
  const subs = audience
    ? all.filter((s) => audienceMatches(audience.audience, passKindOf(s.profile.tickets, audience.config)))
    : all;
  const byToken = new Map<string, PushTarget[]>();
  for (const s of subs) {
    const list = byToken.get(s.profile.token) ?? [];
    list.push({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
    byToken.set(s.profile.token, list);
  }
  return [...byToken].map(([token, list]) => ({ token, subs: list }));
}

/**
 * Eine Nachricht an alle Empfänger; der Link führt in die eigene App. Je Block
 * gehen `PUSH_BLOCK` Kunden gleichzeitig raus (jeder Push mit dem Zeitlimit
 * aus `deliverPush`).
 */
async function sendToAllRiders(targets: RiderTargets, text: AnnounceText, path: string, tag: string): Promise<number> {
  let sent = 0;
  const stale: number[] = [];
  for (const block of chunk(targets)) {
    const results = await Promise.all(
      block.map((t) => deliverPush(t.subs, { ...text, url: `${riderAppPath(t.token)}${path}`, tag })),
    );
    for (const res of results) {
      sent += res.sent;
      stale.push(...res.staleIds);
    }
  }
  if (stale.length > 0) await prisma.riderPushSubscription.deleteMany({ where: { id: { in: stale } } });
  return sent;
}

/**
 * Fällige Meldungen eines Kontos senden. Der Eintrag wird direkt vor dem
 * Versand als gesendet markiert, damit Cron und Speichern nie doppelt melden.
 * Reicht die Zeit bis `deadlineMs` im ungünstigsten Fall nicht, bleibt er
 * unmarkiert für den nächsten Cron-Lauf. `fromCron` startet auch Meldungen,
 * die nie in einen Lauf passen würden.
 */
export async function runAccountAnnouncements(
  accountId: number,
  now: Date = new Date(),
  { deadlineMs = Date.now() + ROUTE_BUDGET_MS, fromCron = false }: { deadlineMs?: number; fromCron?: boolean } = {},
): Promise<number> {
  if (!isWebPushConfigured()) return 0;
  const config = await prisma.gamificationConfig.findUnique({
    where: { accountId },
    select: { enabled: true, beachEnabled: true, subscriptionIds: true, beachSubscriptionIds: true },
  });
  if (!config?.enabled) return 0;
  const today = berlinYmd(now);
  const hour = berlinHour(now);
  let announced = 0;
  const fits = (targets: RiderTargets) =>
    pushFitsBudget(targets.length, Date.now(), deadlineMs, fromCron ? { budgetMs: CRON_BUDGET_MS } : null);

  const offers = await prisma.riderOffer.findMany({
    where: { accountId, pushPlanned: true, pushedAt: null, active: true },
  });
  for (const o of offers) {
    const fromYmd = o.validFrom ? dbDateToYmd(o.validFrom) : null;
    const toYmd = o.validTo ? dbDateToYmd(o.validTo) : null;
    if (offerAnnounceBlock({ ...o, fromYmd, toYmd }, today, hour) !== null) continue;
    const targets = await riderTargets(accountId, { audience: o.audience, config });
    if (!fits(targets)) continue;
    const claimed = await prisma.riderOffer.updateMany({
      where: { id: o.id, accountId, pushedAt: null },
      data: { pushedAt: now },
    });
    if (claimed.count !== 1) continue;
    const sent = await sendToAllRiders(targets, offerPushText({ title: o.title, text: o.text, toYmd, kind: o.kind }), "", `rider-${o.kind === "NEWS" ? "news" : "offer"}-${o.id}`);
    await prisma.riderOffer.update({ where: { id: o.id }, data: { pushSent: sent } });
    announced++;
  }

  const challenges = await prisma.challenge.findMany({
    where: { accountId, pushPlanned: true, pushedAt: null, active: true },
  });
  for (const c of challenges) {
    const startYmd = dbDateToYmd(c.startDate);
    const endYmd = dbDateToYmd(c.endDate);
    if (challengeAnnounceBlock({ ...c, startYmd, endYmd }, today, hour) !== null) continue;
    const targets = await riderTargets(accountId, { audience: c.audience, config });
    if (!fits(targets)) continue;
    const claimed = await prisma.challenge.updateMany({
      where: { id: c.id, accountId, pushedAt: null },
      data: { pushedAt: now },
    });
    if (claimed.count !== 1) continue;
    const text = challengePushText(
      { ...c, kind: c.kind as ChallengeKind, metric: c.metric as GamiMetric, startYmd, endYmd },
      today,
    );
    const sent = await sendToAllRiders(targets, text, "/challenges", `rider-challenge-${c.id}`);
    await prisma.challenge.update({ where: { id: c.id }, data: { pushSent: sent } });
    announced++;
  }

  // Feiertage: jedes Jahr einmal, sobald der Feiertag in der App erscheint.
  const holidays = await prisma.riderHoliday.findMany({ where: { accountId, pushPlanned: true, active: true } });
  for (const h of holidays) {
    if (holidayAnnounceBlock(h, today, hour) !== null) continue;
    const year = currentHoliday([h], today)!.year;
    const targets = await riderTargets(accountId);
    if (!fits(targets)) continue;
    const claimed = await prisma.riderHoliday.updateMany({
      where: { id: h.id, accountId, OR: [{ pushedYear: null }, { pushedYear: { not: year } }] },
      data: { pushedYear: year, pushedAt: now, pushSent: null },
    });
    if (claimed.count !== 1) continue;
    const sent = await sendToAllRiders(targets, holidayPushText(h), "", `rider-holiday-${h.key}-${year}`);
    await prisma.riderHoliday.update({ where: { id: h.id }, data: { pushSent: sent } });
    announced++;
  }

  // Geburtstage: an die Geräte des Geburtstagskinds, einmal je Jahr.
  announced += await runBirthdayPushes(accountId, now);
  return announced;
}

/** Cron: alle Konten mit eingeschalteter Kunden-App und geplanten Meldungen. */
export async function runAnnouncementTick(now: Date = new Date()): Promise<{ accounts: number; announced: number }> {
  if (!isWebPushConfigured()) return { accounts: 0, announced: 0 };
  const [offers, challenges, holidays, birthdays] = await Promise.all([
    prisma.riderOffer.findMany({ where: { pushPlanned: true, pushedAt: null, active: true }, select: { accountId: true } }),
    prisma.challenge.findMany({ where: { pushPlanned: true, pushedAt: null, active: true }, select: { accountId: true } }),
    // Feiertage melden jedes Jahr neu; ob gerade einer fällig ist, prüft runAccountAnnouncements.
    prisma.riderHoliday.findMany({ where: { pushPlanned: true, active: true }, select: { accountId: true } }),
    birthdayPushAccounts(),
  ]);
  const accounts = [...new Set([...[...offers, ...challenges, ...holidays].map((r) => r.accountId), ...birthdays])];
  let announced = 0;
  const deadlineMs = Date.now() + CRON_BUDGET_MS;
  for (const accountId of accounts) announced += await runAccountAnnouncements(accountId, now, { deadlineMs, fromCron: true });
  return { accounts: accounts.length, announced };
}
