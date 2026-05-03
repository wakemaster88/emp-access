import type { PrismaClient } from "@prisma/client";

/**
 * Statistik-Aggregation fuer die Abo-Seite. Berechnet den Bestand,
 * Neuabschluesse und auslaufende Abos pro Tag fuer ein gleitendes
 * Zeitfenster (Default: 365 Tage).
 */

export interface SubscriptionTimelinePoint {
  /** ISO-Datum YYYY-MM-DD */
  date: string;
  /** Bestand aktiver Abo-Tickets an diesem Tag */
  active: number;
  /** Neue Abo-Tickets, deren startDate auf diesen Tag faellt */
  newCount: number;
  /** Abo-Tickets, deren endDate auf diesen Tag faellt */
  expiredCount: number;
}

export interface SubscriptionTopRow {
  subscriptionId: number;
  name: string;
  active: number;
}

export interface SubscriptionStats {
  /** Gesamt-Anzahl Abo-Tickets in der DB (alle Status) */
  totalAbos: number;
  /** Aktiv heute (gueltig + nicht abgelaufen) */
  activeNow: number;
  /** Aktiv vor `days` Tagen */
  activePast: number;
  /** Wachstum vs. vor `days` Tagen, absolut */
  growthAbs: number;
  /** Wachstum vs. vor `days` Tagen, in Prozent (kann null sein wenn activePast=0) */
  growthPercent: number | null;
  /** Neuabschluesse in den letzten 30 Tagen */
  newLast30: number;
  /** Auslaufende Abos in den naechsten 30 Tagen */
  expiringNext30: number;
  /** Im Fenster ueberhaupt jemals abgelaufene Abos (letzte 30 Tage) */
  expiredLast30: number;
  /** Tagesaufloesung (Laenge = days) */
  timeline: SubscriptionTimelinePoint[];
  /** Top-5 Abos nach aktivem Bestand jetzt */
  top: SubscriptionTopRow[];
  /** Konfiguriertes Fenster in Tagen */
  windowDays: number;
}

function toMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function diffDays(from: Date, to: Date): number {
  const ms = toMidnight(to).getTime() - toMidnight(from).getTime();
  return Math.round(ms / 86_400_000);
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function computeSubscriptionStats(
  db: PrismaClient,
  accountId: number,
  days: number = 365,
): Promise<SubscriptionStats> {
  const today = toMidnight(new Date());
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - (days - 1));

  const next30 = new Date(today);
  next30.setDate(next30.getDate() + 30);
  const last30 = new Date(today);
  last30.setDate(last30.getDate() - 30);

  // Fenster-relevante Abo-Tickets: alle Tickets mit subscriptionId, deren
  // Lebenszeit das Fenster oder die naechsten 30 Tage beruehrt. Damit deckt
  // ein einziger Query Timeline + Stat-Cards ab.
  const cutoff = new Date(windowStart);
  // Auch zukuenftige (auslaufend) und gerade frisch abgelaufene Tickets einschliessen.
  const tickets = await db.ticket.findMany({
    where: {
      accountId,
      subscriptionId: { not: null },
      status: { not: "INVALID" },
      OR: [
        { startDate: null, endDate: null },
        { endDate: null },
        { endDate: { gte: cutoff } },
      ],
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
      subscriptionId: true,
      subscription: { select: { name: true } },
    },
  });

  const totalAbos = await db.ticket.count({
    where: { accountId, subscriptionId: { not: null } },
  });

  // Inverter Aufbau ueber Differenzen-Array fuer O(N + days) Bestand-Berechnung.
  const delta = new Array(days + 1).fill(0);
  const newPerDay = new Array(days).fill(0);
  const expiredPerDay = new Array(days).fill(0);

  let activeNow = 0;
  let activePast = 0;
  let newLast30 = 0;
  let expiringNext30 = 0;
  let expiredLast30 = 0;

  const pastIdx = 0; // entspricht windowStart

  for (const t of tickets) {
    const start = t.startDate ? toMidnight(t.startDate) : null;
    const end = t.endDate ? toMidnight(t.endDate) : null;

    // Aktiv heute / vor `days` Tagen
    const activeOn = (day: Date) => {
      if (start && start.getTime() > day.getTime()) return false;
      if (end && end.getTime() < day.getTime()) return false;
      return true;
    };

    if (activeOn(today)) activeNow++;
    if (activeOn(windowStart)) activePast++;

    if (start && start.getTime() >= last30.getTime() && start.getTime() <= today.getTime()) {
      newLast30++;
    }
    if (end && end.getTime() >= today.getTime() && end.getTime() <= next30.getTime()) {
      expiringNext30++;
    }
    if (end && end.getTime() >= last30.getTime() && end.getTime() < today.getTime()) {
      expiredLast30++;
    }

    // Index-Bereich fuer Timeline berechnen.
    let startIdx = start ? diffDays(windowStart, start) : pastIdx;
    let endIdx = end ? diffDays(windowStart, end) : days - 1;

    if (startIdx < 0) startIdx = 0;
    if (endIdx > days - 1) endIdx = days - 1;
    if (endIdx < 0 || startIdx > days - 1) continue;

    delta[startIdx] += 1;
    delta[endIdx + 1] -= 1;

    if (start) {
      const idx = diffDays(windowStart, start);
      if (idx >= 0 && idx < days) newPerDay[idx]++;
    }
    if (end) {
      const idx = diffDays(windowStart, end);
      if (idx >= 0 && idx < days) expiredPerDay[idx]++;
    }
  }

  // Praefix-Summe -> Bestand pro Tag.
  const timeline: SubscriptionTimelinePoint[] = [];
  let active = 0;
  for (let i = 0; i < days; i++) {
    active += delta[i];
    const date = new Date(windowStart);
    date.setDate(date.getDate() + i);
    timeline.push({
      date: isoDate(date),
      active,
      newCount: newPerDay[i],
      expiredCount: expiredPerDay[i],
    });
  }

  // Top-5 nach aktivem Bestand jetzt.
  const topMap = new Map<number, { name: string; active: number }>();
  for (const t of tickets) {
    if (!t.subscriptionId) continue;
    const start = t.startDate ? toMidnight(t.startDate) : null;
    const end = t.endDate ? toMidnight(t.endDate) : null;
    const isActive =
      (!start || start.getTime() <= today.getTime()) &&
      (!end || end.getTime() >= today.getTime());
    if (!isActive) continue;
    const name = t.subscription?.name ?? `Abo #${t.subscriptionId}`;
    const cur = topMap.get(t.subscriptionId) ?? { name, active: 0 };
    cur.active += 1;
    topMap.set(t.subscriptionId, cur);
  }
  const top: SubscriptionTopRow[] = Array.from(topMap.entries())
    .map(([subscriptionId, v]) => ({ subscriptionId, ...v }))
    .sort((a, b) => b.active - a.active)
    .slice(0, 5);

  const growthAbs = activeNow - activePast;
  const growthPercent = activePast > 0 ? Math.round((growthAbs / activePast) * 1000) / 10 : null;

  return {
    totalAbos,
    activeNow,
    activePast,
    growthAbs,
    growthPercent,
    newLast30,
    expiringNext30,
    expiredLast30,
    timeline,
    top,
    windowDays: days,
  };
}
