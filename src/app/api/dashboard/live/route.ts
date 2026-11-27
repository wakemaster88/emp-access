import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { isPlayerOnline } from "@/lib/audio-constants";
import { berlinDayStart } from "@/lib/berlin-day";
import { buildLiveWarnings, summarizeCameraActivity, type LiveAreaOccupancy } from "@/lib/dashboard-live";
import { activityAt, recentActivityWhere } from "@/lib/camera-events";
import { readLiveMode, shownSnapshotAt } from "@/lib/camera-live-mode";
import { BEACH_LABEL, loadBeachOccupancy } from "@/lib/beach-occupancy";
import { loadRiderOccupancy, OCCUPANCY_LABEL } from "@/lib/rider-occupancy";
import { parseParkingSnapshot } from "@/lib/parking";
import { scanDenyReasonLabel } from "@/lib/scan-deny-reason";
import { loadDayScanCounts, loadSightingCounts } from "@/lib/dashboard-counts";
import { scanTotalsFromCounts, summarizeAreaRateCounts } from "@/lib/turnstile-rate";

export const dynamic = "force-dynamic";

const HEARTBEAT_TYPES = ["RASPBERRY_PI", "AUDIO_PLAYER"] as const;
/** Wie in `/api/dashboard/ops` und `device-offline.ts`. */
const HUB_OFFLINE_AFTER_MS = 5 * 60_000;
const HUB_STALE_AFTER_MS = 7 * 24 * 60 * 60_000;
const CAMERA_OFFLINE_AFTER_MS = 10 * 60_000;
const CLOUD_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

function sameCommit(hubVersion: string, cloudSha: string): boolean {
  const len = Math.min(hubVersion.length, cloudSha.length);
  if (len < 7) return true;
  return hubVersion.slice(0, len) === cloudSha.slice(0, len);
}

/**
 * Live-Lage für den oberen Teil des Dashboards: was passiert gerade am
 * Einlass, was sehen die Kameras, was braucht Aufmerksamkeit. Immer „jetzt“,
 * unabhängig vom gewählten Tag der Statistik darunter.
 *
 * Bewusst ohne ANNY-Abruf und ohne Ticketlisten, damit alle 20 s gepollt
 * werden kann. Bilder (Schnappschüsse) werden nicht mitgeladen.
 */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId, isSuperAdmin } = session;
  const where = isSuperAdmin ? {} : { accountId: accountId! };
  const now = new Date();
  const dayStart = berlinDayStart(now);
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  // Rohe Zaehlabfragen: Mandanten-Filter ausdruecklich, beim Super-Admin keiner.
  const countAccountId = isSuperAdmin ? null : accountId!;

  const [
    turnstiles,
    dayScanCounts,
    recentScans,
    heartbeatDevices,
    cameras,
    hubAgents,
    hubAlerts,
    monitorAlertsOpen,
    monitorAlerts,
    sightingCounts,
    personsLatest,
    vehiclesLatest,
    cameraEvents,
    annyConfig,
  ] = await Promise.all([
    db.device.findMany({
      where: {
        ...where,
        category: "DREHKREUZ",
        OR: [{ accessIn: { not: null } }, { accessOut: { not: null } }],
      },
      select: { id: true, accessIn: true, accessOut: true, countsAsStart: true },
    }),
    // Scans des Tages je Geraet und Ergebnis in der Datenbank gezaehlt.
    loadDayScanCounts(db, countAccountId, dayStart, now),
    db.scan.findMany({
      where: { ...where, scanTime: { gte: dayStart } },
      select: {
        id: true,
        code: true,
        note: true,
        result: true,
        scanTime: true,
        device: { select: { name: true } },
        ticket: { select: { id: true, name: true, firstName: true, lastName: true, ticketTypeName: true } },
      },
      orderBy: { scanTime: "desc" },
      take: 12,
    }),
    db.device.findMany({
      where: { ...where, isActive: true, type: { in: [...HEARTBEAT_TYPES] } },
      select: { id: true, name: true, type: true, category: true, lastUpdate: true },
      orderBy: { name: "asc" },
    }),
    db.camera.findMany({
      where: { ...where, enabled: true },
      select: {
        id: true,
        name: true,
        kind: true,
        host: true,
        snapshotAt: true,
        lastSeenAt: true,
        doorHoldUntil: true,
        doorHoldError: true,
        liveMode: true,
      },
      orderBy: { name: "asc" },
    }),
    db.hubAgent.findMany({
      where,
      select: { id: true, name: true, version: true, status: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
    }),
    db.hubAlert.findMany({
      where: { ...where, resolvedAt: null },
      select: { key: true, title: true, detail: true, severity: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
      take: 20,
    }),
    db.monitorAlert.count({
      where: { ...where, acknowledgedAt: null, occurredAt: { gte: dayAgo } },
    }),
    db.monitorAlert.findMany({
      where: { ...where, acknowledgedAt: null, occurredAt: { gte: dayAgo } },
      select: { id: true, message: true, source: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: 3,
    }),
    loadSightingCounts(db, countAccountId, dayStart, hourAgo),
    db.personSighting.findMany({
      where: { ...where, seenAt: { gte: dayStart } },
      select: {
        id: true,
        seenAt: true,
        matched: true,
        listType: true,
        listedPerson: { select: { name: true } },
        camera: { select: { name: true } },
      },
      orderBy: { seenAt: "desc" },
      take: 6,
    }),
    db.vehicleSighting.findMany({
      where: { ...where, seenAt: { gte: dayStart } },
      select: {
        id: true,
        seenAt: true,
        plate: true,
        matched: true,
        source: true,
        deliveryBrand: true,
        deliveryOpened: true,
        shellyTriggered: true,
        shellyOk: true,
        allowedVehicle: { select: { name: true } },
        camera: { select: { name: true } },
      },
      orderBy: { seenAt: "desc" },
      take: 6,
    }),
    // Auch Ereignisse, die frueher begannen und noch laufen oder erst in
    // dieser Stunde endeten: Anhaltende Bewegung ist ein einziges Ereignis.
    db.cameraEvent.findMany({
      where: { ...where, ...recentActivityWhere(hourAgo, now) },
      select: {
        cameraId: true,
        type: true,
        startedAt: true,
        endedAt: true,
        camera: { select: { name: true, lastSeenAt: true } },
      },
      orderBy: { startedAt: "desc" },
      take: 500,
    }),
    db.apiConfig.findFirst({
      where: { ...where, provider: "ANNY" },
      select: { extraConfig: true, lastUpdate: true },
    }),
  ]);

  // ── Einlass ────────────────────────────────────────────────────────────
  const areaIds = [
    ...new Set(turnstiles.flatMap((d) => [d.accessIn, d.accessOut].filter((x): x is number => x != null))),
  ];
  const areaRows = areaIds.length
    ? await db.accessArea.findMany({
        where: { ...where, id: { in: areaIds } },
        select: { id: true, name: true, personLimit: true },
      })
    : [];
  const areas = summarizeAreaRateCounts(areaRows, turnstiles, dayScanCounts).sort(
    (a, b) => b.in60 - a.in60 || b.inToday - a.inToday || a.name.localeCompare(b.name, "de"),
  );

  const t60 = hourAgo.getTime();
  const totals = scanTotalsFromCounts(dayScanCounts);
  // Auslastung wie in der Kunden-App: Lift (Fahrer der letzten 60 Min an
  // Start-Geräten) und Strandbad (Eintritte 3 h × Faktor). Dieselbe Zahl, die
  // Gäste gerade sehen; am Strandbad verlässlicher als „rein minus raus“,
  // weil am Ausgang kaum jemand scannt.
  const [lift, beach] =
    accountId != null
      ? await Promise.all([
          loadRiderOccupancy(accountId, now).catch(() => null),
          loadBeachOccupancy(accountId, now).catch(() => null),
        ])
      : [null, null];
  const startAreaIds = new Set(
    turnstiles.filter((d) => d.countsAsStart && d.accessIn != null).map((d) => d.accessIn as number),
  );
  const occupancyOf = (area: { id: number; name: string }): LiveAreaOccupancy | null => {
    if (lift && startAreaIds.has(area.id)) {
      return { kind: "lift", level: lift.level, label: OCCUPANCY_LABEL[lift.level], riders: lift.riders, starts: lift.starts };
    }
    if (beach && beach.areaName === area.name) {
      return {
        kind: "beach",
        level: beach.level,
        label: BEACH_LABEL[beach.level],
        estimated: beach.estimated,
        entries: beach.entries,
        capacity: beach.capacity,
      };
    }
    return null;
  };

  const insideAreas = areas.filter((a) => a.inside != null);
  const inside = insideAreas.length > 0 ? insideAreas.reduce((sum, a) => sum + (a.inside ?? 0), 0) : null;

  // ── Geräte, Kameras, Hub ───────────────────────────────────────────────
  const hubOfflineCutoff = now.getTime() - HUB_OFFLINE_AFTER_MS;
  const hubStaleCutoff = now.getTime() - HUB_STALE_AFTER_MS;
  const liveHubs = hubAgents.filter((h) => h.lastSeenAt && h.lastSeenAt.getTime() > hubStaleCutoff);
  const hubs = liveHubs.map((h) => {
    const online = h.lastSeenAt!.getTime() > hubOfflineCutoff;
    return {
      name: h.name,
      online,
      outdated: online && !!CLOUD_COMMIT && !!h.version && !sameCommit(h.version, CLOUD_COMMIT),
    };
  });
  const anyHubOnline = hubs.some((h) => h.online);

  // Kameras meldet der Hub. Ist er selbst weg, sagt `lastSeenAt` nichts über
  // die Kamera – dann zählt nur der Hub-Ausfall (wie in device-offline.ts).
  const cameraCutoff = now.getTime() - CAMERA_OFFLINE_AFTER_MS;
  const watchedCameras = cameras.filter((c) => c.lastSeenAt);
  const camerasOffline = anyHubOnline
    ? watchedCameras.filter((c) => c.lastSeenAt!.getTime() < cameraCutoff).map((c) => c.name)
    : [];

  const devicesOffline = heartbeatDevices.filter((d) => !isPlayerOnline(d.lastUpdate));
  const readers = heartbeatDevices.filter((d) => d.type === "RASPBERRY_PI");

  const lastOpening = vehiclesLatest.find((v) => v.deliveryOpened || (v.shellyTriggered && v.shellyOk !== false));
  const gates = cameras
    .filter((c) => c.kind === "DOORBIRD")
    .map((c) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      // Livebild und Vorschau: „nur auf Tippen“ oder „aus“ ohne Bild im Dialog.
      liveMode: readLiveMode(c.liveMode),
      snapshotAt: shownSnapshotAt(c.liveMode, c.snapshotAt),
      online: anyHubOnline && !!c.lastSeenAt && c.lastSeenAt.getTime() >= cameraCutoff,
      holdUntil: c.doorHoldUntil && c.doorHoldUntil.getTime() > now.getTime() ? c.doorHoldUntil : null,
      holdError: c.doorHoldError,
    }));

  // ── Tracking ───────────────────────────────────────────────────────────
  const { persons, vehicles } = sightingCounts;

  const activity = summarizeCameraActivity(
    cameraEvents.map((e) => ({
      cameraId: e.cameraId,
      cameraName: e.camera.name,
      type: e.type,
      at: activityAt(e, e.camera.lastSeenAt, now),
    })),
  );

  const parkingHub = hubAgents.find((h) => h.lastSeenAt && h.lastSeenAt.getTime() > hubOfflineCutoff);
  const parkingSnapshot = parkingHub ? parseParkingSnapshot(parkingHub.status) : null;
  const parking =
    parkingSnapshot && parkingSnapshot.lots.length > 0
      ? {
          trackerOnline: parkingSnapshot.trackerOnline,
          // Unbekannte Zählung zählt 0 (count bleibt eine Zahl für ältere Ansichten).
          total: parkingSnapshot.lots.reduce((sum, l) => sum + (l.state === "unbekannt" ? 0 : l.count), 0),
          lots: parkingSnapshot.lots.map((l) => ({ name: l.name, count: l.count, state: l.state })),
        }
      : null;

  // ── Warnungen ──────────────────────────────────────────────────────────
  let anny: { lastSync: Date | null; errors: number } | null = null;
  if (annyConfig) {
    let lastSync = annyConfig.lastUpdate ?? null;
    let errors = 0;
    try {
      const sr = annyConfig.extraConfig ? JSON.parse(annyConfig.extraConfig)?.lastSyncResult : null;
      if (sr?.at) lastSync = new Date(sr.at);
      if (typeof sr?.errors === "number") errors = sr.errors;
    } catch {
      /* kein JSON */
    }
    anny = { lastSync, errors };
  }

  const warnings = buildLiveWarnings({
    now,
    monitorAlerts,
    monitorAlertsOpen,
    hubs,
    hubAlerts,
    camerasOffline,
    devicesOffline: devicesOffline.map((d) => d.name),
    blacklistSightings: personsLatest
      .filter((p) => p.listType === "BLACKLIST" && p.seenAt.getTime() >= t60)
      .map((p) => ({
        id: p.id,
        name: p.listedPerson?.name ?? null,
        cameraName: p.camera?.name ?? null,
        seenAt: p.seenAt,
      })),
    noParking: vehiclesLatest
      .filter((v) => v.source === "NO_PARKING" && v.seenAt.getTime() >= t60)
      .map((v) => ({ id: v.id, plate: v.plate, cameraName: v.camera?.name ?? null, seenAt: v.seenAt })),
    gates,
    areas,
    anny,
  });

  return NextResponse.json({
    at: now.toISOString(),
    warnings,
    access: {
      inside,
      ...totals,
      areas: areas.map((a) => ({ ...a, occupancy: occupancyOf(a) })),
      recent: recentScans.map((s) => ({
        id: s.id,
        result: s.result,
        scanTime: s.scanTime.toISOString(),
        deviceName: s.device?.name ?? null,
        ticketId: s.ticket?.id ?? null,
        name: s.ticket
          ? [s.ticket.firstName, s.ticket.lastName].filter(Boolean).join(" ") || s.ticket.name
          : s.code,
        typeName: s.ticket?.ticketTypeName ?? null,
        reason: s.result === "GRANTED" ? null : scanDenyReasonLabel(s.note),
      })),
    },
    status: {
      readers: {
        online: readers.filter((d) => isPlayerOnline(d.lastUpdate)).length,
        total: readers.length,
        offline: readers.filter((d) => !isPlayerOnline(d.lastUpdate)).map((d) => d.name),
      },
      cameras: {
        online: anyHubOnline ? watchedCameras.length - camerasOffline.length : 0,
        total: watchedCameras.length,
        offline: camerasOffline,
        hubOnline: anyHubOnline,
      },
      gates: gates.map((g) => ({
        id: g.id,
        name: g.name,
        host: g.host,
        liveMode: g.liveMode,
        snapshotAt: g.snapshotAt?.toISOString() ?? null,
        online: g.online,
        holdUntil: g.holdUntil?.toISOString() ?? null,
        holdError: g.holdUntil ? g.holdError : null,
      })),
      lastOpening: lastOpening
        ? {
            at: lastOpening.seenAt.toISOString(),
            label: lastOpening.deliveryBrand || lastOpening.allowedVehicle?.name || lastOpening.plate || null,
          }
        : null,
    },
    tracking: {
      persons: {
        ...persons,
        latest: personsLatest.map((p) => ({
          id: p.id,
          seenAt: p.seenAt.toISOString(),
          name: p.listedPerson?.name ?? null,
          listType: p.listType,
          cameraName: p.camera?.name ?? null,
        })),
      },
      vehicles: {
        ...vehicles,
        latest: vehiclesLatest.map((v) => ({
          id: v.id,
          seenAt: v.seenAt.toISOString(),
          plate: v.plate,
          name: v.allowedVehicle?.name ?? null,
          matched: v.matched,
          noParking: v.source === "NO_PARKING",
          deliveryBrand: v.deliveryBrand,
          opened: v.deliveryOpened || (v.shellyTriggered && v.shellyOk !== false),
          cameraName: v.camera?.name ?? null,
        })),
      },
      movement: {
        last60: activity.reduce((sum, c) => sum + c.total, 0),
        cameras: activity.slice(0, 6),
      },
      parking,
    },
  });
}
