/**
 * Push-Benachrichtigungen der Kunden-App. Jedes Abo gehört zu einem Profil
 * und entsteht nur, wenn der Fahrer es auf seinem Gerät selbst einschaltet.
 * Gesendet wird an die Person, die es betrifft, und bei einem Kind an die
 * Erwachsenen seiner Familie.
 */
import { z } from "zod";
import { prisma } from "./prisma";
import { riderAppPath } from "./rider-app";
import { deliverPush, isWebPushConfigured, type PushPayload } from "./web-push";

/** Mehr Geräte je Fahrer braucht niemand; schützt die Tabelle vor Müll. */
export const MAX_RIDER_PUSH_DEVICES = 10;

/** Push-Dienste der Browser. Andere Adressen nimmt der Server nicht an, damit er nie beliebige Ziele aufruft. */
const PUSH_HOSTS = ["fcm.googleapis.com", ".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

export function isPushServiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    return PUSH_HOSTS.some((h) => (h.startsWith(".") ? url.hostname.endsWith(h) : url.hostname === h));
  } catch {
    return false;
  }
}

export const riderPushSubscriptionSchema = z.object({
  endpoint: z.string().max(2000).refine(isPushServiceUrl),
  keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(300) }),
});
export type RiderPushSubscriptionInput = z.infer<typeof riderPushSubscriptionSchema>;

/** Abo dieses Geräts speichern; ein schon bekanntes Gerät zieht zum Profil um. */
export async function saveRiderPush(
  profileId: number,
  accountId: number,
  sub: RiderPushSubscriptionInput,
): Promise<void> {
  const data = { p256dh: sub.keys.p256dh, auth: sub.keys.auth, profileId, accountId };
  await prisma.riderPushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, ...data },
    update: data,
  });
  // Älteste Geräte über der Grenze entfernen.
  const extra = await prisma.riderPushSubscription.findMany({
    where: { profileId, accountId },
    orderBy: { updatedAt: "desc" },
    skip: MAX_RIDER_PUSH_DEVICES,
    select: { id: true },
  });
  if (extra.length > 0) {
    await prisma.riderPushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  }
}

/** Nachricht an alle Geräte eines Profils; abgelaufene Abos fliegen raus. */
export async function sendPushToRider(profileId: number, accountId: number, payload: PushPayload): Promise<number> {
  if (!isWebPushConfigured()) return 0;
  const subs = await prisma.riderPushSubscription.findMany({ where: { profileId, accountId } });
  const { sent, staleIds } = await deliverPush(subs, payload);
  if (staleIds.length > 0) {
    await prisma.riderPushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }
  return sent;
}

/**
 * Neuer Gutschein: die Person hinter dem Ticket benachrichtigen. Läuft neben
 * dem Scan her und darf ihn nie aufhalten oder scheitern lassen.
 */
export function notifyVoucher(accountId: number, ticketId: number, label: string): void {
  if (!isWebPushConfigured()) return;
  void (async () => {
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, accountId, riderProfileId: { not: null } },
      select: { firstName: true, riderProfile: { select: { id: true, token: true, familyId: true, familyAdult: true } } },
    });
    const profile = ticket?.riderProfile;
    if (!profile) return;
    const url = `${riderAppPath(profile.token)}/gutscheine`;
    await sendPushToRider(profile.id, accountId, {
      title: "Neuer Gutschein",
      body: `${label} wartet in deiner App auf dich.`,
      url,
      tag: "rider-voucher",
    });
    // Kinder haben oft kein eigenes Gerät: die Erwachsenen der Familie erfahren es auch.
    if (profile.familyId == null || profile.familyAdult) return;
    const adults = await prisma.riderProfile.findMany({
      where: { accountId, familyId: profile.familyId, familyAdult: true },
      select: { id: true },
    });
    const who = ticket?.firstName?.trim() || "dein Kind";
    for (const adult of adults) {
      await sendPushToRider(adult.id, accountId, {
        title: "Neuer Gutschein",
        body: `${label} für ${who} wartet in der App.`,
        url,
        tag: `rider-voucher-${profile.id}`,
      });
    }
  })().catch((e) => console.error("[rider-push] Gutschein-Meldung fehlgeschlagen:", e));
}
