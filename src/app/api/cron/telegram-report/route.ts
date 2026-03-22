import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";
import { buildTelegramDailyReport } from "@/lib/telegram-daily-report";

export const maxDuration = 30;

/** Stabile HH:mm für Berlin – de-DE liefert oft schmales Leerzeichen (U+202F) statt ":" → DB "20:00" matcht nie */
function berlinHHmm(): string {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

function normalizeDailyTime(s: string): string {
  return s
    .trim()
    .replace(/\u202f/g, "")
    .replace(/\./g, ":");
}

function verifyCronAuth(request: NextRequest): { ok: true } | { ok: false; status: number; body: object } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "CRON_SECRET ist nicht gesetzt",
        hint: "In Vercel: Projekt → Settings → Environment Variables → CRON_SECRET (min. 16 Zeichen). Nach dem Anlegen neu deployen.",
      },
    };
  }
  const auth = request.headers.get("authorization")?.trim();
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (bearer !== secret) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Unauthorized",
        hint: "Vercel sendet Authorization: Bearer <CRON_SECRET>. Wert in Vercel muss exakt mit CRON_SECRET übereinstimmen.",
      },
    };
  }
  return { ok: true };
}

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  const currentTime = berlinHHmm();

  const configs = await prisma.telegramConfig.findMany({
    where: { isActive: true, dailyReport: true },
  });

  const matchingConfigs = configs.filter((c) => normalizeDailyTime(c.dailyReportTime) === currentTime);

  if (matchingConfigs.length === 0) {
    return NextResponse.json({
      message: "Keine Berichte fällig",
      berlinTime: currentTime,
      configsWithDailyReport: configs.length,
      scheduledTimes: configs.map((c) => normalizeDailyTime(c.dailyReportTime)),
    });
  }

  const results: { accountId: number; ok: boolean; error?: string }[] = [];

  for (const config of matchingConfigs) {
    try {
      const report = await buildTelegramDailyReport(config.accountId);
      const res = await sendTelegramMessage(config.botToken, config.chatId, report);
      results.push({ accountId: config.accountId, ok: res.ok, error: res.description });
    } catch (err) {
      results.push({ accountId: config.accountId, ok: false, error: String(err) });
    }
  }

  return NextResponse.json({ sent: results.length, results });
}
