/**
 * Push an alle Kunden der App, wenn ein neues Angebot oder eine neue
 * Challenge veröffentlicht wird. Die Verwaltung setzt beim Anlegen den
 * Schalter „Push senden“ (`pushPlanned`); gesendet wird genau einmal
 * (`pushedAt`), sobald der Eintrag für Kunden sichtbar ist und es Tag ist.
 * Läuft direkt nach dem Speichern und im 5-Minuten-Cron für geplante Einträge.
 *
 * Empfänger sind nur Geräte, auf denen ein Kunde Benachrichtigungen selbst
 * eingeschaltet hat (`RiderPushSubscription`). Ohne VAPID-Keys (lokal, Tests)
 * geht nichts raus.
 */
import { prisma } from "./prisma";
import { berlinHour, berlinYmd } from "./berlin-day";
import { dbDateToYmd, type ChallengeKind, type GamiMetric } from "./gamification";
import { riderAppPath } from "./rider-app";
import { deliverPush, isWebPushConfigured } from "./web-push";
import {
  challengeAnnounceBlock,
  challengePushText,
  offerAnnounceBlock,
  offerPushText,
  type AnnounceText,
} from "./rider-announce-rules";

/** Wie viele Kunden und Geräte ein Push erreichen würde. */
export async function riderPushReach(accountId: number): Promise<{ devices: number; riders: number }> {
  const subs = await prisma.riderPushSubscription.findMany({ where: { accountId }, select: { profileId: true } });
  return { devices: subs.length, riders: new Set(subs.map((s) => s.profileId)).size };
}

/** Eine Nachricht an jedes Gerät mit Push-Erlaubnis; der Link führt in die eigene App. */
async function sendToAllRiders(accountId: number, text: AnnounceText, path: string, tag: string): Promise<number> {
  const subs = await prisma.riderPushSubscription.findMany({
    where: { accountId },
    select: { id: true, endpoint: true, p256dh: true, auth: true, profile: { select: { token: true } } },
  });
  const byToken = new Map<string, typeof subs>();
  for (const s of subs) {
    const list = byToken.get(s.profile.token) ?? [];
    list.push(s);
    byToken.set(s.profile.token, list);
  }
  let sent = 0;
  const stale: number[] = [];
  for (const [token, targets] of byToken) {
    const res = await deliverPush(targets, { ...text, url: `${riderAppPath(token)}${path}`, tag });
    sent += res.sent;
    stale.push(...res.staleIds);
  }
  if (stale.length > 0) await prisma.riderPushSubscription.deleteMany({ where: { id: { in: stale } } });
  return sent;
}

/**
 * Fällige Meldungen eines Kontos senden. Der Eintrag wird vorher als
 * gesendet markiert, damit Cron und Speichern nie doppelt melden.
 */
export async function runAccountAnnouncements(accountId: number, now: Date = new Date()): Promise<number> {
  if (!isWebPushConfigured()) return 0;
  const config = await prisma.gamificationConfig.findUnique({ where: { accountId }, select: { enabled: true } });
  if (!config?.enabled) return 0;
  const today = berlinYmd(now);
  const hour = berlinHour(now);
  let announced = 0;

  const offers = await prisma.riderOffer.findMany({
    where: { accountId, pushPlanned: true, pushedAt: null, active: true },
  });
  for (const o of offers) {
    const fromYmd = o.validFrom ? dbDateToYmd(o.validFrom) : null;
    const toYmd = o.validTo ? dbDateToYmd(o.validTo) : null;
    if (offerAnnounceBlock({ ...o, fromYmd, toYmd }, today, hour) !== null) continue;
    const claimed = await prisma.riderOffer.updateMany({
      where: { id: o.id, accountId, pushedAt: null },
      data: { pushedAt: now },
    });
    if (claimed.count !== 1) continue;
    const sent = await sendToAllRiders(accountId, offerPushText({ title: o.title, text: o.text, toYmd }), "", `rider-offer-${o.id}`);
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
    const claimed = await prisma.challenge.updateMany({
      where: { id: c.id, accountId, pushedAt: null },
      data: { pushedAt: now },
    });
    if (claimed.count !== 1) continue;
    const text = challengePushText(
      { ...c, kind: c.kind as ChallengeKind, metric: c.metric as GamiMetric, startYmd, endYmd },
      today,
    );
    const sent = await sendToAllRiders(accountId, text, "/challenges", `rider-challenge-${c.id}`);
    await prisma.challenge.update({ where: { id: c.id }, data: { pushSent: sent } });
    announced++;
  }
  return announced;
}

/** Cron: alle Konten mit eingeschalteter Kunden-App und geplanten Meldungen. */
export async function runAnnouncementTick(now: Date = new Date()): Promise<{ accounts: number; announced: number }> {
  if (!isWebPushConfigured()) return { accounts: 0, announced: 0 };
  const [offers, challenges] = await Promise.all([
    prisma.riderOffer.findMany({ where: { pushPlanned: true, pushedAt: null, active: true }, select: { accountId: true } }),
    prisma.challenge.findMany({ where: { pushPlanned: true, pushedAt: null, active: true }, select: { accountId: true } }),
  ]);
  const accounts = [...new Set([...offers, ...challenges].map((r) => r.accountId))];
  let announced = 0;
  for (const accountId of accounts) announced += await runAccountAnnouncements(accountId, now);
  return { accounts: accounts.length, announced };
}
