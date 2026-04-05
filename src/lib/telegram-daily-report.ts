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

  const in7Days = new Date(dayEnd);
  in7Days.setDate(in7Days.getDate() + 7);

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { name: true },
  });

  const [
    scansToday,
    grantedToday,
    deniedToday,
    checkedInToday,
    bookingsToday,
    bookingsTomorrow,
    expiringAbos,
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
    prisma.ticket.findMany({
      where: { accountId, createdAt: { gte: dayStart, lte: dayEnd } },
      select: { ticketTypeName: true, subscriptionId: true, subscription: { select: { name: true } } },
    }),
    prisma.ticket.findMany({
      where: {
        accountId,
        status: { in: ["VALID", "REDEEMED"] },
        OR: [
          { startDate: { gte: tomorrowStart, lte: tomorrowEnd } },
          { startDate: { lte: tomorrowEnd }, endDate: { gte: tomorrowStart } },
        ],
      },
      select: { ticketTypeName: true, subscriptionId: true, subscription: { select: { name: true } } },
    }),
    prisma.ticket.findMany({
      where: {
        accountId,
        subscriptionId: { not: null },
        status: { in: ["VALID", "REDEEMED", "PAUSED"] },
        endDate: { gt: dayEnd, lte: in7Days },
      },
      select: { firstName: true, lastName: true, name: true, ticketTypeName: true, endDate: true },
      orderBy: { endDate: "asc" },
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

  function groupByService(tickets: { ticketTypeName: string | null; subscriptionId: number | null; subscription?: { name: string } | null }[]) {
    const abos = new Map<string, number>();
    const singles = new Map<string, number>();
    for (const t of tickets) {
      const isSub = t.subscriptionId != null;
      const label = isSub
        ? (t.subscription?.name ?? t.ticketTypeName ?? "Abo")
        : (t.ticketTypeName ?? "Sonstige");
      const map = isSub ? abos : singles;
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return { abos, singles };
  }

  function fmtServiceGroup(map: Map<string, number>): string {
    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return sorted.map(([name, count]) => `  • ${name}: <b>${count}</b>`).join("\n");
  }

  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  let msg = `📊 <b>Tagesbericht – ${account?.name ?? "Account"}</b>\n`;
  msg += `📅 ${dateStr}, ${timeStr}\n\n`;

  msg += `<b>✅ Eingecheckt heute</b>\n`;
  msg += `• <b>${checkedInToday.length}</b> Personen eingecheckt\n`;
  msg += `• ${scansToday} Scans gesamt (✅ ${grantedToday} / ❌ ${deniedToday})\n\n`;

  const todayGroups = groupByService(bookingsToday);
  const todayTicketCount = bookingsToday.filter((t) => !t.subscriptionId).length;
  const todayAboCount = bookingsToday.filter((t) => t.subscriptionId).length;

  msg += `<b>🎫 Neue Tickets heute</b> (${todayTicketCount})\n`;
  if (todayGroups.singles.size > 0) {
    msg += fmtServiceGroup(todayGroups.singles) + "\n";
  } else {
    msg += `  • Keine\n`;
  }
  msg += `\n`;

  msg += `<b>📋 Neue Abos heute</b> (${todayAboCount})\n`;
  if (todayGroups.abos.size > 0) {
    msg += fmtServiceGroup(todayGroups.abos) + "\n";
  } else {
    msg += `  • Keine\n`;
  }
  msg += `\n`;

  const tomorrowGroups = groupByService(bookingsTomorrow);
  const tomorrowTicketCount = bookingsTomorrow.filter((t) => !t.subscriptionId).length;
  const tomorrowAboCount = bookingsTomorrow.filter((t) => t.subscriptionId).length;

  msg += `<b>📅 Tickets morgen</b> (${tomorrowTicketCount})\n`;
  if (tomorrowGroups.singles.size > 0) {
    msg += fmtServiceGroup(tomorrowGroups.singles) + "\n";
  } else {
    msg += `  • Keine\n`;
  }
  msg += `\n`;

  msg += `<b>📋 Abos morgen</b> (${tomorrowAboCount})\n`;
  if (tomorrowGroups.abos.size > 0) {
    msg += fmtServiceGroup(tomorrowGroups.abos) + "\n";
  } else {
    msg += `  • Keine\n`;
  }
  msg += `\n`;

  if (expiringAbos.length > 0) {
    msg += `<b>⚠️ Ablaufende Abos (7 Tage)</b>\n`;
    for (const t of expiringAbos) {
      const personName = [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
      const endStr = t.endDate
        ? new Date(t.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
        : "";
      msg += `  • ${personName}${t.ticketTypeName ? ` (${t.ticketTypeName})` : ""} – ${endStr}\n`;
    }
    msg += `\n`;
  }

  if (pausedTickets > 0) {
    msg += `<b>⏸ Pausiert</b>\n  • ${pausedTickets} Ticket${pausedTickets !== 1 ? "s" : ""} pausiert\n\n`;
  }

  if (topNames.length > 0) {
    msg += `<b>🔝 Meiste Scans heute</b>\n`;
    for (const t of topNames) {
      msg += `  • ${t.name}: ${t.count}×\n`;
    }
  }

  return msg;
}
