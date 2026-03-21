import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";

export const maxDuration = 30;

function berlinNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
}

function berlinHHmm() {
  const now = new Date();
  return now.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentTime = berlinHHmm();

  const configs = await prisma.telegramConfig.findMany({
    where: { isActive: true, dailyReport: true },
  });

  const matchingConfigs = configs.filter((c) => c.dailyReportTime === currentTime);

  if (matchingConfigs.length === 0) {
    return NextResponse.json({ message: "Keine Berichte fällig", time: currentTime });
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

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { name: true },
  });

  const [
    totalTickets,
    activeTickets,
    scansToday,
    grantedToday,
    deniedToday,
    checkedInToday,
    newTicketsToday,
    areas,
    topScanned,
  ] = await Promise.all([
    prisma.ticket.count({ where: { accountId } }),
    prisma.ticket.count({ where: { accountId, status: { in: ["VALID", "REDEEMED"] } } }),
    prisma.scan.count({ where: { accountId, scanTime: { gte: dayStart, lte: dayEnd } } }),
    prisma.scan.count({ where: { accountId, scanTime: { gte: dayStart, lte: dayEnd }, result: "GRANTED" } }),
    prisma.scan.count({ where: { accountId, scanTime: { gte: dayStart, lte: dayEnd }, result: "DENIED" } }),
    prisma.scan.findMany({
      where: { accountId, scanTime: { gte: dayStart, lte: dayEnd }, result: "GRANTED" },
      select: { ticketId: true },
      distinct: ["ticketId"],
    }),
    prisma.ticket.count({ where: { accountId, createdAt: { gte: dayStart, lte: dayEnd } } }),
    prisma.accessArea.findMany({
      where: { accountId },
      select: {
        name: true,
        _count: { select: { tickets: { where: { status: { in: ["VALID", "REDEEMED"] } } } } },
      },
    }),
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

  msg += `<b>📈 Übersicht</b>\n`;
  msg += `• Scans heute: <b>${scansToday}</b> (✅ ${grantedToday} / ❌ ${deniedToday})\n`;
  msg += `• Eingecheckt: <b>${checkedInToday.length}</b> Personen\n`;
  msg += `• Neue Buchungen: <b>${newTicketsToday}</b>\n`;
  msg += `• Aktive Tickets: <b>${activeTickets}</b> / ${totalTickets} gesamt\n\n`;

  if (areas.length > 0) {
    msg += `<b>📍 Bereiche</b>\n`;
    for (const area of areas) {
      msg += `• ${area.name}: ${area._count.tickets} aktive Tickets\n`;
    }
    msg += `\n`;
  }

  if (topNames.length > 0) {
    msg += `<b>🔝 Meiste Scans heute</b>\n`;
    for (const t of topNames) {
      msg += `• ${t.name}: ${t.count}×\n`;
    }
  }

  return msg;
}
