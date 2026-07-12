/**
 * Web-Push-Versand (VAPID) an die im Dashboard registrierten PWA-Geraete.
 *
 * Benoetigt drei Env-Variablen (Vercel → Settings → Environment Variables):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  – oeffentlicher VAPID-Key (auch im Client)
 *   VAPID_PRIVATE_KEY             – privater VAPID-Key (nur Server)
 *   VAPID_SUBJECT                 – "mailto:…" Kontaktadresse (optional)
 *
 * Key-Paar erzeugen: `npx web-push generate-vapid-keys`
 */
import webpush from "web-push";
import { prisma } from "./prisma";

export interface PushPayload {
  title: string;
  body: string;
  /** Ziel-URL beim Klick auf die Benachrichtigung (relativ, z.B. "/devices/5"). */
  url?: string;
  /** Gleicher Tag ersetzt eine noch sichtbare Benachrichtigung (kein Spam). */
  tag?: string;
}

let vapidConfigured = false;

export function isWebPushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:info@tuttenbrocksee.com",
    publicKey,
    privateKey,
  );
  vapidConfigured = true;
  return true;
}

/**
 * Sendet eine Push-Nachricht an alle Subscriptions eines Accounts.
 * Abgelaufene Endpoints (404/410) werden automatisch aus der DB entfernt.
 */
export async function sendPushToAccount(
  accountId: number,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; removed: number }> {
  if (!ensureVapid()) return { sent: 0, failed: 0, removed: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { accountId },
  });
  if (subscriptions.length === 0) return { sent: 0, failed: 0, removed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const staleIds: number[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 },
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(sub.id);
        } else {
          failed++;
          console.error(`[web-push] Senden an Subscription ${sub.id} fehlgeschlagen:`, statusCode ?? err);
        }
      }
    }),
  );

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }

  return { sent, failed, removed: staleIds.length };
}
