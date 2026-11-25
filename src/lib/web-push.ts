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
import { prisma } from "./prisma";

// Die Bibliothek `web-push` wird erst beim ersten Versand geladen; viele
// Routen importieren dieses Modul, senden aber selten oder nie.
type WebPushLib = typeof import("web-push");
let webpushLib: Promise<WebPushLib> | null = null;
function loadWebPush(): Promise<WebPushLib> {
  // Schlaegt das Laden fehl, wird beim naechsten Versand neu geladen.
  webpushLib ??= import("web-push").then(
    (m) => (m as { default?: WebPushLib }).default ?? m,
    (err) => {
      webpushLib = null;
      throw err;
    },
  );
  return webpushLib;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Ziel-URL beim Klick auf die Benachrichtigung (relativ, z.B. "/devices/5"). */
  url?: string;
  /** Gleicher Tag ersetzt eine noch sichtbare Benachrichtigung (kein Spam). */
  tag?: string;
  /** Meldung bleibt sichtbar, bis jemand reagiert (Android/Desktop; iOS ignoriert es). */
  requireInteraction?: boolean;
}

let vapidConfigured = false;

/** Zeitlimit je Push-Dienst-Aufruf (Socket-Timeout von web-push). */
const PUSH_TIMEOUT_MS = 5_000;

export function isWebPushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function ensureVapid(): Promise<WebPushLib | null> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!vapidConfigured && (!publicKey || !privateKey)) return null;
  const webpush = await loadWebPush();
  if (vapidConfigured) return webpush;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:info@tuttenbrocksee.com",
    publicKey!,
    privateKey!,
  );
  vapidConfigured = true;
  return webpush;
}

export interface PushTarget {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Schickt eine Nachricht an die übergebenen Abos. `staleIds` sind Abos, die
 * der Push-Dienst als abgelaufen meldet (404/410): der Aufrufer löscht sie.
 */
export async function deliverPush(
  targets: PushTarget[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; staleIds: number[] }> {
  if (targets.length === 0) return { sent: 0, failed: 0, staleIds: [] };
  const webpush = await ensureVapid();
  if (!webpush) return { sent: 0, failed: 0, staleIds: [] };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const staleIds: number[] = [];

  await Promise.all(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          // Antwortet der Push-Dienst nicht, bricht der Versand nach 5 s ab
          // und zaehlt wie ein Netzwerkfehler als fehlgeschlagen.
          { TTL: 60 * 60, timeout: PUSH_TIMEOUT_MS },
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

  return { sent, failed, staleIds };
}

/**
 * Sendet eine Push-Nachricht an alle Subscriptions eines Accounts.
 * Abgelaufene Endpoints (404/410) werden automatisch aus der DB entfernt.
 */
export async function sendPushToAccount(
  accountId: number,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; removed: number }> {
  if (!isWebPushConfigured()) return { sent: 0, failed: 0, removed: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { accountId },
  });
  const { sent, failed, staleIds } = await deliverPush(subscriptions, payload);

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }

  return { sent, failed, removed: staleIds.length };
}
