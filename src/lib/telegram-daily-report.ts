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
      select: {
        firstName: true,
        lastName: true,
        name: true,
        ticketTypeName: true,
        subscriptionId: true,
        vereinId: true,
        source: true,
        slotStart: true,
        slotEnd: true,
        startDate: true,
        endDate: true,
        validityType: true,
        validityDurationMinutes: true,
        subscription: { select: { name: true } },
        service: { select: { name: true } },
      },
    }),
    prisma.ticket.findMany({
      where: {
        accountId,
        // Vereinsmitglieder und Mitarbeiter (EMP_CONTROL) bewusst ausblenden:
        // sie haben keine Tagesbuchung, sondern langlaufende Tickets, und
        // wuerden die Liste sonst sprengen.
        vereinId: null,
        source: { not: "EMP_CONTROL" },
        status: { in: ["VALID", "REDEEMED"] },
        OR: [
          { startDate: { gte: tomorrowStart, lte: tomorrowEnd } },
          { startDate: { lte: tomorrowEnd }, endDate: { gte: tomorrowStart } },
        ],
      },
      select: {
        firstName: true,
        lastName: true,
        name: true,
        ticketTypeName: true,
        subscriptionId: true,
        vereinId: true,
        source: true,
        slotStart: true,
        slotEnd: true,
        startDate: true,
        endDate: true,
        validityType: true,
        validityDurationMinutes: true,
        subscription: { select: { name: true } },
        service: { select: { name: true } },
      },
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

  type BookingTicket = {
    firstName: string | null;
    lastName: string | null;
    name: string;
    ticketTypeName: string | null;
    subscriptionId: number | null;
    vereinId: number | null;
    source: string | null;
    slotStart: string | null;
    slotEnd: string | null;
    startDate: Date | null;
    endDate: Date | null;
    validityType: string;
    validityDurationMinutes: number | null;
    subscription?: { name: string } | null;
    service?: { name: string } | null;
  };

  function isDayTicket(t: BookingTicket): boolean {
    return t.subscriptionId == null && t.vereinId == null && t.source !== "EMP_CONTROL";
  }

  function berlinHHMM(d: Date): string {
    const berlin = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    return `${String(berlin.getHours()).padStart(2, "0")}:${String(berlin.getMinutes()).padStart(2, "0")}`;
  }

  /**
   * Liefert "HH:MM" nur fuer echte Slot-Buchungen (Bahnmieten,
   * Anfaengerkurs, Grillplatz etc.). Erkennungsregeln in dieser
   * Reihenfolge:
   *   1. `slotStart` ist gesetzt -> direkter Treffer.
   *   2. `validityType=TIME_SLOT` mit `startDate` -> Uhrzeit aus startDate.
   *   3. `validityType=DATE_RANGE` mit kurzem Fenster (<= 4h) -> Slot
   *      (z.B. Anfaengerkurs 12:00-13:00, der ohne slotStart angelegt
   *      wurde). Tageskarten (10h+) und Abendkarten fallen raus.
   * `DURATION`-Tickets sind nie Slots: dort ist `startDate`/`endDate`
   * nur das Oeffnungsfenster, nicht die gebuchte Stunde - die startet
   * erst beim ersten Scan.
   */
  function bookingTime(t: BookingTicket): string | null {
    if (t.slotStart) return t.slotStart;
    if (t.validityType === "TIME_SLOT" && t.startDate) {
      return berlinHHMM(t.startDate);
    }
    if (t.validityType === "DATE_RANGE" && t.startDate && t.endDate) {
      const diffH = (t.endDate.getTime() - t.startDate.getTime()) / 3_600_000;
      if (diffH > 0 && diffH <= 4) return berlinHHMM(t.startDate);
    }
    return null;
  }

  function bookingLabel(t: BookingTicket): string {
    return t.service?.name ?? t.ticketTypeName ?? "Sonstige";
  }

  function bookingPersonName(t: BookingTicket): string {
    const full = [t.firstName, t.lastName].filter(Boolean).join(" ");
    return full || t.name;
  }

  /**
   * Gruppiert Slot-Tickets nach (Uhrzeit, Service) und fasst Mehrfach-
   * buchungen zur gleichen Stunde zusammen. Beispiel-Output:
   *   • 12:00 Wakeboard Bahnmiete: 4
   *   • 14:00 Übungslift: 2
   */
  function fmtSlotted(tickets: BookingTicket[]): string {
    const byKey = new Map<string, { time: string; label: string; count: number; names: string[] }>();
    for (const t of tickets) {
      const time = bookingTime(t)!;
      const label = bookingLabel(t);
      const key = `${time}|${label}`;
      const entry = byKey.get(key) ?? { time, label, count: 0, names: [] };
      entry.count++;
      entry.names.push(bookingPersonName(t));
      byKey.set(key, entry);
    }
    return Array.from(byKey.values())
      .sort((a, b) => a.time.localeCompare(b.time) || a.label.localeCompare(b.label))
      .map((e) => `  • <b>${e.time}</b> ${e.label}: <b>${e.count}</b>`)
      .join("\n");
  }

  function fmtUnslotted(tickets: BookingTicket[]): string {
    const counts = new Map<string, number>();
    for (const t of tickets) {
      const label = bookingLabel(t);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `  • ${label}: <b>${count}</b>`)
      .join("\n");
  }

  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  let msg = `📊 <b>Tagesbericht – ${account?.name ?? "Account"}</b>\n`;
  msg += `📅 ${dateStr}, ${timeStr}\n\n`;

  msg += `<b>✅ Eingecheckt heute</b>\n`;
  msg += `• <b>${checkedInToday.length}</b> Personen eingecheckt\n`;
  msg += `• ${scansToday} Scans gesamt (✅ ${grantedToday} / ❌ ${deniedToday})\n\n`;

  // Tagestickets heute (ohne Abos / Vereine / Mitarbeiter), getrennt nach
  // "mit Uhrzeit" (Bahnmiete, Anfaengerkurs etc.) und "ohne Uhrzeit"
  // (klassische Tageskarte).
  const todayDayTickets = (bookingsToday as BookingTicket[]).filter(isDayTicket);
  const todaySlotted = todayDayTickets.filter((t) => bookingTime(t) != null);
  const todayUnslotted = todayDayTickets.filter((t) => bookingTime(t) == null);

  msg += `<b>🎫 Neue Tickets heute</b> (${todayDayTickets.length})\n`;
  if (todaySlotted.length > 0) {
    msg += fmtSlotted(todaySlotted) + "\n";
  }
  if (todayUnslotted.length > 0) {
    msg += fmtUnslotted(todayUnslotted) + "\n";
  }
  if (todayDayTickets.length === 0) {
    msg += `  • Keine\n`;
  }
  msg += `\n`;

  const todayAbos = bookingsToday.filter((t) => t.subscriptionId);
  msg += `<b>📋 Neue Abos heute</b> (${todayAbos.length})\n`;
  if (todayAbos.length > 0) {
    for (const t of todayAbos) {
      const personName = [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
      const aboName = t.subscription?.name ?? t.ticketTypeName ?? "Abo";
      msg += `  • ${personName} (${aboName})\n`;
    }
  } else {
    msg += `  • Keine\n`;
  }
  msg += `\n`;

  // Tickets morgen: Vereine + Mitarbeiter sind schon in der Query
  // ausgefiltert. Wir teilen weiter in Abos, Slot-Tickets (mit Uhrzeit)
  // und Tagestickets (ohne Uhrzeit).
  const tomorrowAll = bookingsTomorrow as BookingTicket[];
  const tomorrowDayTickets = tomorrowAll.filter(isDayTicket);
  const tomorrowSlotted = tomorrowDayTickets.filter((t) => bookingTime(t) != null);
  const tomorrowUnslotted = tomorrowDayTickets.filter((t) => bookingTime(t) == null);

  msg += `<b>📅 Tickets morgen</b> (${tomorrowDayTickets.length})\n`;
  if (tomorrowSlotted.length > 0) {
    msg += fmtSlotted(tomorrowSlotted) + "\n";
  }
  if (tomorrowUnslotted.length > 0) {
    msg += fmtUnslotted(tomorrowUnslotted) + "\n";
  }
  if (tomorrowDayTickets.length === 0) {
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
