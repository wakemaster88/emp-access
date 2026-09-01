import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { isPlayerOnline, isQuietTime } from "@/lib/audio-constants";
import {
  berlinDayRange,
  berlinHm,
  berlinWeekdayBit,
  berlinYmd,
} from "@/lib/berlin-day";

const HEARTBEAT_TYPES = ["RASPBERRY_PI", "AUDIO_PLAYER"] as const;

/**
 * Ein Hub meldet sich alle 30 s. 5 min Toleranz wie in den Detailseiten
 * (`/network`, `/cameras`, `/fahrzeuge`) – ein einzelner verpasster
 * Heartbeat oder ein Update-Neustart soll noch nicht Alarm schlagen.
 */
const HUB_OFFLINE_AFTER_MS = 5 * 60_000;

/**
 * Ein Hub, der seit Tagen nichts meldet, ist keine Störung mehr, sondern eine
 * alte Karteileiche (z. B. umbenannter `HUB_NAME`). Sonst stünde das Widget
 * dauerhaft auf Rot.
 */
const HUB_STALE_AFTER_MS = 7 * 24 * 60 * 60_000;

/**
 * Commit, der gerade auf Vercel läuft. Die Hubs fahren dasselbe `origin/main`
 * und melden ihren Stand im Heartbeat – weicht er ab, hat der Hub das letzte
 * Update noch nicht gezogen. Lokal (ohne Vercel-Env) bleibt der Vergleich aus.
 */
const CLOUD_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

/**
 * Hub- und Cloud-Hash sind unterschiedlich lang: `git rev-parse --short`
 * liefert 7 Zeichen, bei Kollisionen mehr (beobachtet: 8), Vercel liefert die
 * volle SHA. Deshalb über das gemeinsame Präfix vergleichen statt stur kürzen.
 */
function sameCommit(hubVersion: string, cloudSha: string): boolean {
  const len = Math.min(hubVersion.length, cloudSha.length);
  if (len < 7) return true; // zu kurz für eine belastbare Aussage
  return hubVersion.slice(0, len) === cloudSha.slice(0, len);
}

/**
 * Schlanker Ist-Zustand für die Dashboard-Leiste.
 *
 * Bewusst getrennt von `/api/dashboard`: die Tagesansicht holt ANNY-Slots
 * und Ticketlisten, hier soll alle 15 s gepollt werden ohne den Park
 * jedes Mal gegen anny.co zu schicken.
 */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId, isSuperAdmin } = session;
  const where = isSuperAdmin ? {} : { accountId: accountId! };
  const now = new Date();
  const today = berlinYmd(now);
  const { start: dayStart, endExclusive } = berlinDayRange(today);
  const hm = berlinHm(now);
  const dow = berlinWeekdayBit(now);

  const [zones, heartbeatDevices, openAlertCount, openAlerts, unmatchedVehicles, unmatchedToday, irrigRuns, irrigSchedules, hubAgents] =
    await Promise.all([
      db.audioZone.findMany({
        where: { ...where, isActive: true },
        select: {
          id: true,
          name: true,
          isPlaying: true,
          currentTitle: true,
          sourceKind: true,
          quietFrom: true,
          quietTo: true,
          externalSender: true,
          device: { select: { lastUpdate: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      db.device.findMany({
        where: { ...where, isActive: true, type: { in: [...HEARTBEAT_TYPES] } },
        select: { id: true, name: true, type: true, lastUpdate: true },
        orderBy: { name: "asc" },
      }),
      db.monitorAlert.count({
        where: { ...where, acknowledgedAt: null, occurredAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
      }),
      db.monitorAlert.findMany({
        where: { ...where, acknowledgedAt: null, occurredAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
        select: { id: true, kind: true, message: true, source: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
        take: 5,
      }),
      db.vehicleSighting.findMany({
        where: {
          ...where,
          matched: false,
          seenAt: { gte: dayStart, lt: endExclusive },
        },
        select: { id: true, plate: true, seenAt: true, camera: { select: { name: true } } },
        orderBy: { seenAt: "desc" },
        take: 5,
      }),
      db.vehicleSighting.count({
        where: {
          ...where,
          matched: false,
          seenAt: { gte: dayStart, lt: endExclusive },
        },
      }),
      db.irrigationRun.findMany({
        where: { ...where, startedAt: { gte: new Date(now.getTime() - 3 * 60 * 60_000) } },
        select: {
          startedAt: true,
          durationMinutes: true,
          device: { select: { name: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 20,
      }),
      db.irrigationSchedule.findMany({
        where: { ...where, isActive: true },
        select: {
          startTime: true,
          daysOfWeek: true,
          durationMinutes: true,
          runState: true,
          device: { select: { name: true } },
        },
      }),
      db.hubAgent.findMany({
        where,
        select: { id: true, name: true, hostname: true, version: true, lastSeenAt: true },
        orderBy: { lastSeenAt: "desc" },
      }),
    ]);

  const watering: { name: string; remainingMin: number }[] = [];
  const seenWatering = new Set<string>();
  for (const run of irrigRuns) {
    const ends = run.startedAt.getTime() + run.durationMinutes * 60_000;
    if (ends <= now.getTime()) continue;
    const name = run.device.name;
    if (seenWatering.has(name)) continue;
    seenWatering.add(name);
    watering.push({
      name,
      remainingMin: Math.max(1, Math.round((ends - now.getTime()) / 60_000)),
    });
  }
  for (const s of irrigSchedules) {
    if (!s.runState) continue;
    const name = s.device.name;
    if (seenWatering.has(name)) continue;
    seenWatering.add(name);
    watering.push({ name, remainingMin: s.durationMinutes });
  }

  const nextSchedule =
    irrigSchedules
      .filter((s) => ((s.daysOfWeek >> dow) & 1) === 1 && s.startTime >= hm)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0] ?? null;

  const offlinePlayers = heartbeatDevices.filter((d) => !isPlayerOnline(d.lastUpdate));

  const hubOfflineCutoff = now.getTime() - HUB_OFFLINE_AFTER_MS;
  const hubStaleCutoff = now.getTime() - HUB_STALE_AFTER_MS;
  const hubs = hubAgents
    .filter((h) => h.lastSeenAt && h.lastSeenAt.getTime() > hubStaleCutoff)
    .map((h) => {
      const online = !!h.lastSeenAt && h.lastSeenAt.getTime() > hubOfflineCutoff;
      return {
        id: h.id,
        name: h.name,
        hostname: h.hostname,
        version: h.version,
        lastSeenAt: h.lastSeenAt?.toISOString() ?? null,
        online,
        // Nur bei erreichbaren Hubs aussagekräftig – ein offline Hub ist per se alt.
        outdated: online && !!CLOUD_COMMIT && !!h.version && !sameCommit(h.version, CLOUD_COMMIT),
      };
    });

  return NextResponse.json({
    audio: {
      zones: zones.map((z) => ({
        id: z.id,
        name: z.name,
        isPlaying: z.isPlaying,
        currentTitle: z.currentTitle,
        sourceKind: z.sourceKind,
        streamName: null,
        externalSender: z.externalSender,
        quiet: isQuietTime(z.quietFrom, z.quietTo, hm),
        deviceOnline: isPlayerOnline(z.device?.lastUpdate),
      })),
    },
    irrigation: {
      watering,
      next: nextSchedule
        ? { name: nextSchedule.device.name, startTime: nextSchedule.startTime }
        : null,
    },
    alerts: {
      open: openAlertCount,
      latest: openAlerts.map((a) => ({
        id: a.id,
        kind: a.kind,
        message: a.message,
        source: a.source,
        occurredAt: a.occurredAt.toISOString(),
      })),
    },
    vehicles: {
      unmatchedToday,
      latest: unmatchedVehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        seenAt: v.seenAt.toISOString(),
        cameraName: v.camera?.name ?? null,
      })),
    },
    devices: {
      heartbeatOnline: heartbeatDevices.length - offlinePlayers.length,
      heartbeatTotal: heartbeatDevices.length,
      offline: offlinePlayers.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        lastUpdate: d.lastUpdate?.toISOString() ?? null,
      })),
    },
    hubs: {
      online: hubs.filter((h) => h.online).length,
      total: hubs.length,
      cloudCommit: CLOUD_COMMIT?.slice(0, 7) ?? null,
      agents: hubs,
    },
  });
}
