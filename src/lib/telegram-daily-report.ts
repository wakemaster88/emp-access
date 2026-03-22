import { prisma } from "@/lib/prisma";

function berlinNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
}

/** Vollständiger Tagesbericht-Text (HTML für Telegram), wie vom Cron-Job. */
export async function buildTelegramDailyReport(accountId: number): Promise<string> {
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
    prisma.ticket.count({
      where: { accountId, createdAt: { gte: dayStart, lte: dayEnd }, subscriptionId: null },
    }),
    prisma.ticket.count({
      where: { accountId, createdAt: { gte: dayStart, lte: dayEnd }, subscriptionId: { not: null } },
    }),
    prisma.ticket.findMany({
      where: {
        accountId,
        subscriptionId: { not: null },
        endDate: { gte: dayStart, lte: dayEnd },
        status: { in: ["INVALID", "CANCELED"] },
      },
      select: { firstName: true, lastName: true, name: true, ticketTypeName: true },
    }),
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
