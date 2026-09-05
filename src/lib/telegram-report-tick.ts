import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";
import { buildTelegramDailyReport } from "@/lib/telegram-daily-report";
import { berlinYmd } from "@/lib/berlin-day";

/** Wie lange nach der eingestellten Uhrzeit ein Bericht noch nachgeholt wird. */
const DUE_WINDOW_MIN = 20;

/** Stabile HH:mm fuer Berlin – de-DE liefert oft U+202F statt ":" */
function berlinMinutesOfDay(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (h % 24) * 60 + m;
}

export function parseDailyTime(s: string): number | null {
  const norm = s.trim().replace(/ /g, "").replace(/\./g, ":");
  const m = norm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Faellig, wenn die eingestellte Zeit innerhalb der letzten DUE_WINDOW_MIN
 * Minuten lag und heute (Berlin) noch kein Bericht gesendet wurde. Damit
 * verpasst ein verspaeteter Cron-Tick den Bericht nicht mehr, und ein
 * doppelter Tick sendet ihn nicht zweimal.
 */
export function isReportDue(
  dailyReportTime: string,
  lastSentAt: Date | null,
  now: Date,
): boolean {
  const scheduled = parseDailyTime(dailyReportTime);
  if (scheduled == null) return false;
  const nowMin = berlinMinutesOfDay(now);
  if (nowMin < scheduled || nowMin >= scheduled + DUE_WINDOW_MIN) return false;
  if (lastSentAt && berlinYmd(lastSentAt) === berlinYmd(now)) return false;
  return true;
}

export async function runTelegramReportTick(now = new Date()) {
  const configs = await prisma.telegramConfig.findMany({
    where: { isActive: true, dailyReport: true },
    select: { id: true, accountId: true, botToken: true, chatId: true, dailyReportTime: true, dailyReportLastSentAt: true },
  });

  const due = configs.filter((c) => isReportDue(c.dailyReportTime, c.dailyReportLastSentAt, now));
  const results: { accountId: number; ok: boolean; error?: string }[] = [];

  for (const config of due) {
    try {
      const report = await buildTelegramDailyReport(config.accountId);
      const res = await sendTelegramMessage(config.botToken, config.chatId, report);
      if (res.ok) {
        await prisma.telegramConfig.update({
          where: { id: config.id },
          data: { dailyReportLastSentAt: now },
        });
      }
      results.push({ accountId: config.accountId, ok: res.ok, error: res.description });
    } catch (err) {
      results.push({ accountId: config.accountId, ok: false, error: String(err) });
    }
  }

  return { checked: configs.length, sent: results.filter((r) => r.ok).length, results };
}
