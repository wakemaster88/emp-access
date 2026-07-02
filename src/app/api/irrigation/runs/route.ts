import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/** Kalendertag (YYYY-MM-DD) in der Account-Zeitzone. */
function dateKeyInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function fmtDayLabel(dateKey: string, tz: string): string {
  const [y, m, day] = dateKey.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, day, 12));
  const todayKey = dateKeyInTz(new Date(), tz);
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yestKey = dateKeyInTz(yest, tz);
  const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: tz, weekday: "short" }).format(noon);
  const dateStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
  }).format(noon);
  if (dateKey === todayKey) return `Heute, ${weekday} ${dateStr}`;
  if (dateKey === yestKey) return `Gestern, ${weekday} ${dateStr}`;
  return `${weekday} ${dateStr}`;
}

const SOURCE_LABELS: Record<string, string> = {
  schedule: "Zeitplan",
  schedule_now: "Manuell (Zeitplan)",
  manual: "Manuell",
};

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") || "14")));

  const account = await db.account.findUnique({
    where: { id: accountId! },
    select: { timezone: true },
  });
  const tz = account?.timezone ?? "Europe/Berlin";

  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const runs = await db.irrigationRun.findMany({
    where: { accountId: accountId!, startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    include: {
      device: { select: { id: true, name: true } },
    },
  });

  type RunEntry = {
    id: number;
    deviceId: number;
    deviceName: string;
    startedAt: string;
    durationMinutes: number;
    source: string;
    sourceLabel: string;
    litersEstimate: number | null;
    scheduleId: number | null;
  };

  type ValveDay = {
    deviceId: number;
    deviceName: string;
    totalMinutes: number;
    totalLiters: number;
    runCount: number;
    runs: RunEntry[];
  };

  type DayBucket = {
    date: string;
    label: string;
    totalMinutes: number;
    totalLiters: number;
    runCount: number;
    valves: ValveDay[];
  };

  const byDay = new Map<string, DayBucket>();

  for (const run of runs) {
    const date = dateKeyInTz(run.startedAt, tz);
    let day = byDay.get(date);
    if (!day) {
      day = {
        date,
        label: fmtDayLabel(date, tz),
        totalMinutes: 0,
        totalLiters: 0,
        runCount: 0,
        valves: [],
      };
      byDay.set(date, day);
    }

    const liters = run.litersEstimate ?? 0;
    day.totalMinutes += run.durationMinutes;
    day.totalLiters += liters;
    day.runCount += 1;

    let valve = day.valves.find((v) => v.deviceId === run.deviceId);
    if (!valve) {
      valve = {
        deviceId: run.deviceId,
        deviceName: run.device.name,
        totalMinutes: 0,
        totalLiters: 0,
        runCount: 0,
        runs: [],
      };
      day.valves.push(valve);
    }
    valve.totalMinutes += run.durationMinutes;
    valve.totalLiters += liters;
    valve.runCount += 1;
    valve.runs.push({
      id: run.id,
      deviceId: run.deviceId,
      deviceName: run.device.name,
      startedAt: run.startedAt.toISOString(),
      durationMinutes: run.durationMinutes,
      source: run.source,
      sourceLabel: SOURCE_LABELS[run.source] ?? run.source,
      litersEstimate: run.litersEstimate,
      scheduleId: run.scheduleId,
    });
  }

  // Ventile pro Tag nach Gesamtminuten sortieren; Tage absteigend nach Datum.
  const dayList = [...byDay.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => ({
      ...d,
      totalLiters: Math.round(d.totalLiters),
      valves: d.valves
        .sort((a, b) => b.totalMinutes - a.totalMinutes)
        .map((v) => ({ ...v, totalLiters: Math.round(v.totalLiters) })),
    }));

  const summary = dayList.reduce(
    (acc, d) => ({
      totalMinutes: acc.totalMinutes + d.totalMinutes,
      totalLiters: acc.totalLiters + d.totalLiters,
      runCount: acc.runCount + d.runCount,
    }),
    { totalMinutes: 0, totalLiters: 0, runCount: 0 },
  );

  return NextResponse.json({ days: dayList, summary, daysRequested: days });
}
