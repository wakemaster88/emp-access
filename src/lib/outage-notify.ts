/**
 * Ausfall-Meldungen an einen Account: Web-Push an die PWA-Geraete und
 * Telegram an alle aktiven Chats mit „Ausfälle melden“ (Standard: an).
 *
 * Wird vom 5-Minuten-Cron (Geraete, Hub, Kameras, Soundweb) und von
 * /api/hub/alerts (Befunde der Switch-Pruefung) genutzt. Fehler beim
 * Versand werden geloggt, nie geworfen – der Aufrufer hat den Zustand
 * schon fortgeschrieben, damit es kein Dauerfeuer gibt.
 */
import { prisma } from "./prisma";
import { sendPushToAccount } from "./web-push";
import { sendTelegramMessage } from "./telegram";
import { escapeHtml } from "./email-templates";

export interface OutageMessage {
  title: string;
  body: string;
  /** Ziel-URL beim Antippen der Push-Meldung. */
  url?: string;
  /** Gleicher Tag ersetzt eine noch sichtbare Push-Meldung. */
  tag?: string;
}

export interface OutageSendResult {
  pushed: number;
  telegram: number;
}

export async function notifyOutage(accountId: number, msg: OutageMessage): Promise<OutageSendResult> {
  const out: OutageSendResult = { pushed: 0, telegram: 0 };
  try {
    const push = await sendPushToAccount(accountId, msg);
    out.pushed = push.sent;
  } catch (err) {
    console.error("[outage-notify] push failed:", err);
  }
  try {
    const chats = await prisma.telegramConfig.findMany({
      where: { accountId, isActive: true, notifyOutages: true },
      select: { botToken: true, chatId: true },
    });
    const text = `<b>${escapeHtml(msg.title)}</b>\n${escapeHtml(msg.body)}`;
    for (const c of chats) {
      try {
        const res = await sendTelegramMessage(c.botToken, c.chatId, text);
        if (res.ok) out.telegram++;
        else console.error("[outage-notify] telegram failed:", res.description);
      } catch (err) {
        console.error("[outage-notify] telegram error:", err);
      }
    }
  } catch (err) {
    console.error("[outage-notify] telegram lookup failed:", err);
  }
  return out;
}

/** Accounts, die ueberhaupt einen Meldeweg haben (Push-Abo oder Telegram). */
export async function accountsWithOutageChannel(): Promise<number[]> {
  const [push, telegram] = await Promise.all([
    prisma.pushSubscription.groupBy({ by: ["accountId"] }),
    prisma.telegramConfig.findMany({
      where: { isActive: true, notifyOutages: true },
      select: { accountId: true },
      distinct: ["accountId"],
    }),
  ]);
  return [...new Set([...push.map((p) => p.accountId), ...telegram.map((t) => t.accountId)])].sort(
    (a, b) => a - b,
  );
}

export interface OutageCandidate {
  id: number;
  /** Letztes Lebenszeichen; null = nie gesehen (wird nicht gemeldet). */
  offlineSince: Date | null;
  /** true = gerade erreichbar. */
  online: boolean;
  offlineNotifiedAt: Date | null;
}

/**
 * Zustandsuebergaenge bestimmen: offline laenger als `graceMs` und noch nicht
 * gemeldet → wentOffline; gemeldet und wieder online → cameOnline. Laenger als
 * `staleMs` tot (Karteileiche) wird nicht mehr neu gemeldet.
 */
export function outageTransitions<T extends OutageCandidate>(
  rows: T[],
  now: number,
  graceMs: number,
  staleMs: number,
): { wentOffline: T[]; cameOnline: T[] } {
  const wentOffline: T[] = [];
  const cameOnline: T[] = [];
  for (const r of rows) {
    if (r.online) {
      if (r.offlineNotifiedAt) cameOnline.push(r);
      continue;
    }
    if (r.offlineNotifiedAt || !r.offlineSince) continue;
    const since = r.offlineSince.getTime();
    if (now - since >= graceMs && now - since < staleMs) wentOffline.push(r);
  }
  return { wentOffline, cameOnline };
}

export function formatBerlinTime(d: Date): string {
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

/** „seit 14:32 Uhr“ bzw. „seit 03.11. 14:32 Uhr“, wenn es nicht heute war. */
export function formatSince(d: Date, now = new Date()): string {
  const day = (x: Date) => x.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  const time = formatBerlinTime(d);
  if (day(d) === day(now)) return `seit ${time} Uhr`;
  const date = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
  return `seit ${date} ${time} Uhr`;
}
