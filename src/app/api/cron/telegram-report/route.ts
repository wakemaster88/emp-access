import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";

export const maxDuration = 30;

function berlinNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
}

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
      const report = await buildReport(config.accountId);
      const res = await sendTelegramMessage(config.botToken, config.chatId, report);
      results.push({ accountId: config.accountId, ok: res.ok, error: res.description });
    } catch (err) {
      results.push({ accountId: config.accountId, ok: false, error: String(err) });
    }
  }

  return NextResponse.json({ sent: results.length, results });
}

async function buildReport(accountId: number): Promise<string> {
  const now = berlinNow();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  const tomorrowStart = new Date(dayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { name: true },
  });

  const [
    scansToday,
    grantedToday,
    deniedToday,
    checkedInToday,
    newBookingsToday,
    newAbosToday,
    expiredAbosToday,
    ticketsTomorrow,
    pausedTickets,
    topScanned,
  ] = await Promise.all([
    prisma.scan.count({ where: { accountId, scanTime: { gte: dayStart, lte: dayEnd } } }),
    prisma.scan.count({ where: { accountId, scanTime: { gte: dayStart, lte: dayEnd }, result: "GRANTED" } }),
    prisma.scan.count({ where: { accountId, scanTime: { gte: dayStart, lte: dayEnd }, result: "DENIED" } }),
    prisma.scan.findMany({
      where: { accountId, scanTime: { gte: dayStart, lte: dayEnd }, result: "GRANTED" },
      select: { ticketId: true },
      distinct: ["ticketId"],
    }),
    // Neue Buchungen heute (Einzeltickets ohne Abo)
    prisma.ticket.count({
      where: { accountId, createdAt: { gte: dayStart, lte: dayEnd }, subscriptionId: null },
    }),
    // Neue Abos heute
    prisma.ticket.count({
      where: { accountId, createdAt: { gte: dayStart, lte: dayEnd }, subscriptionId: { not: null } },
    }),
    // Abgelaufene Abos (endDate heute oder frueher, hatten Abo)
    prisma.ticket.findMany({
      where: {
        accountId,
        subscriptionId: { not: null },
        endDate: { gte: dayStart, lte: dayEnd },
        status: { in: ["INVALID", "CANCELED"] },
      },
      select: { firstName: true, lastName: true, name: true, ticketTypeName: true },
    }),
    // Tickets fuer morgen (startDate morgen ODER gueltig mit endDate nach morgen)
    prisma.ticket.count({
      where: {
        accountId,
        status: { in: ["VALID", "REDEEMED"] },
        OR: [
          { startDate: { gte: tomorrowStart, lte: tomorrowEnd } },
          { startDate: { lte: tomorrowEnd }, endDate: { gte: tomorrowStart } },
        ],
      },
    }),
    prisma.ticket.count({ where: { accountId, status: "PAUSED" } }),
    prisma.scan.groupBy({
      by: ["ticketId"],
      where: { accountId, scanTime: { gte: dayStart, lte: dayEnd }, result: "GRANTED", ticketId: { not: null } },
      _count: true,
      orderBy: { _count: { ticketId: "desc" } },
      take: 5,
    }),
  ]);

  let topNames: { name: string; count: number }[] = [];
  if (topScanned.length > 0) {
    const ids = topScanned.map((t) => t.ticketId).filter((id): id is number => id != null);
    const tickets = await prisma.ticket.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, name: true },
    });
    const nameMap = new Map(tickets.map((t) => [t.id, [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name]));
    topNames = topScanned.map((t) => ({
      name: nameMap.get(t.ticketId!) ?? "Unbekannt",
      count: t._count,
    }));
  }

  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  let msg = `📊 <b>Tagesbericht – ${account?.name ?? "Account"}</b>\n`;
  msg += `📅 ${dateStr}, ${timeStr}\n\n`;

  msg += `<b>✅ Eingecheckt heute</b>\n`;
  msg += `• <b>${checkedInToday.length}</b> Personen eingecheckt\n`;
  msg += `• ${scansToday} Scans gesamt (✅ ${grantedToday} / ❌ ${deniedToday})\n\n`;

  msg += `<b>🆕 Neue Buchungen heute</b>\n`;
  msg += `• Einzelbuchungen: <b>${newBookingsToday}</b>\n`;
  msg += `• Neue Abos: <b>${newAbosToday}</b>\n\n`;

  if (expiredAbosToday.length > 0) {
    msg += `<b>⏰ Abgelaufene Abos heute</b>\n`;
    for (const t of expiredAbosToday) {
      const personName = [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
      msg += `• ${personName}${t.ticketTypeName ? ` (${t.ticketTypeName})` : ""}\n`;
    }
    msg += `\n`;
  } else {
    msg += `<b>⏰ Abgelaufene Abos heute</b>\n• Keine\n\n`;
  }

  msg += `<b>📅 Tickets morgen</b>\n`;
  msg += `• <b>${ticketsTomorrow}</b> gültige Tickets\n\n`;

  if (pausedTickets > 0) {
    msg += `<b>⏸ Pausiert</b>\n• ${pausedTickets} Ticket${pausedTickets !== 1 ? "s" : ""} pausiert\n\n`;
  }

  if (topNames.length > 0) {
    msg += `<b>🔝 Meiste Scans heute</b>\n`;
    for (const t of topNames) {
      msg += `• ${t.name}: ${t.count}×\n`;
    }
  }

  return msg;
}
