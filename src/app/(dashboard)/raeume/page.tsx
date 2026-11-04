import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { RaeumeClient } from "@/components/raeume/raeume-client";
import type {
  NetworkItem,
  RoomCamera,
  RoomDevice,
  RoomEvent,
  RoomPanel,
  RoomZone,
} from "@/components/raeume/types";
import { safeAuth } from "@/lib/auth";
import { superAdminClient, tenantClient, type TenantDb } from "@/lib/prisma";
import { isPlayerOnline } from "@/lib/audio-constants";
import { scheduleInclude } from "@/lib/operating-queries";
import { DEFAULT_TIMEZONE } from "@/lib/tz-time";
import { climateView } from "@/lib/room-climate";
import { buildRoomActivity, dayStart } from "@/lib/room-activity";

/** Fenster, in dem eine Bewegung im Raum noch als "zuletzt" gezeigt wird. */
const EVENT_LOOKBACK_HOURS = 24;

const deviceSelect = {
  id: true,
  name: true,
  type: true,
  category: true,
  isActive: true,
  ipAddress: true,
  lastUpdate: true,
  pulseSeconds: true,
  task: true,
} as const;

const cameraSelect = {
  id: true,
  name: true,
  kind: true,
  enabled: true,
  snapshotAt: true,
  lastSeenAt: true,
} as const;

const zoneSelect = {
  id: true,
  name: true,
  isActive: true,
  deviceId: true,
  isPlaying: true,
  currentTitle: true,
  lastStateAt: true,
  device: { select: { lastUpdate: true } },
} as const;

type DeviceRecord = {
  id: number;
  name: string;
  type: string;
  category: string | null;
  isActive: boolean;
  ipAddress: string | null;
  lastUpdate: Date | null;
  pulseSeconds: number | null;
  task: number;
};

type CameraRecord = {
  id: number;
  name: string;
  kind: string;
  enabled: boolean;
  snapshotAt: Date | null;
  lastSeenAt: Date | null;
};

function toDevice(d: DeviceRecord): RoomDevice {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    category: d.category,
    isActive: d.isActive,
    hasLocalAddress: !!d.ipAddress,
    lastUpdate: d.lastUpdate ? d.lastUpdate.toISOString() : null,
    pulseSeconds: d.pulseSeconds,
    task: d.task,
  };
}

type ZoneRecord = {
  id: number;
  name: string;
  isActive: boolean;
  deviceId: number | null;
  isPlaying: boolean;
  currentTitle: string | null;
  lastStateAt: Date | null;
  device: { lastUpdate: Date | null } | null;
};

function toZone(z: ZoneRecord): RoomZone {
  // Ein Pi, der sich nicht mehr meldet, spielt auch nichts – sonst stuende
  // "spielt" fuer immer an einer stummen Zone.
  const online = isPlayerOnline(z.device?.lastUpdate);
  return {
    id: z.id,
    name: z.name,
    isActive: z.isActive,
    hasPlayer: z.deviceId !== null,
    isPlaying: online && z.isPlaying,
    currentTitle: online ? z.currentTitle : null,
    lastStateAt: z.lastStateAt ? z.lastStateAt.toISOString() : null,
  };
}

function toCamera(c: CameraRecord): RoomCamera {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    enabled: c.enabled,
    snapshotAt: c.snapshotAt ? c.snapshotAt.toISOString() : null,
    lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
  };
}

export default async function RaeumePage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db: TenantDb = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };
  const now = new Date();
  const since = new Date(now);
  since.setHours(since.getHours() - EVENT_LOOKBACK_HOURS);

  const [rooms, looseDevices, looseCameras, looseZones, events, schedules, account, netDevices, netClients] = await Promise.all([
    db.keyRoom.findMany({
      where: accountFilter,
      include: {
        devices: { select: deviceSelect, orderBy: { name: "asc" } },
        cameras: { select: cameraSelect, orderBy: { name: "asc" } },
        audioZones: { select: zoneSelect, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
        operatingSchedule: { include: scheduleInclude },
        climate: true,
        rules: {
          select: {
            id: true,
            name: true,
            trigger: true,
            isActive: true,
            lastRunAt: true,
            _count: { select: { actions: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
        doors: {
          select: {
            name: true,
            doorNumber: true,
            locks: {
              select: {
                id: true,
                lockNumber: true,
                lockType: true,
                deviceId: true,
                device: { select: { name: true } },
              },
              orderBy: { id: "asc" },
            },
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: [{ building: "asc" }, { name: "asc" }],
    }),
    db.device.findMany({
      where: { ...accountFilter, keyRoomId: null },
      select: deviceSelect,
      orderBy: { name: "asc" },
    }),
    db.camera.findMany({
      where: { ...accountFilter, keyRoomId: null },
      select: cameraSelect,
      orderBy: { name: "asc" },
    }),
    db.audioZone.findMany({
      where: { ...accountFilter, keyRoomId: null },
      select: zoneSelect,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    // Je Kamera nur das jüngste Ereignis. `distinct` ist hier wichtig und
    // nicht bloss sparsam: eine einzelne Kamera meldet ueber tausend
    // Ereignisse pro Tag, eine Liste der neuesten N waere komplett von ihr
    // belegt und andere Raeume blieben ohne Angabe.
    db.cameraEvent.findMany({
      where: {
        ...accountFilter,
        startedAt: { gte: since },
        camera: { keyRoomId: { not: null } },
      },
      select: {
        cameraId: true,
        type: true,
        startedAt: true,
        camera: { select: { name: true, keyRoomId: true } },
      },
      orderBy: { startedAt: "desc" },
      distinct: ["cameraId"],
    }),
    db.operatingSchedule.findMany({
      where: accountFilter,
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    isSuperAdmin
      ? Promise.resolve(null)
      : db.account.findUnique({
          where: { id: session.user.accountId! },
          select: { timezone: true },
        }),
    db.networkDevice.findMany({
      where: accountFilter,
      select: { id: true, name: true, type: true, ipAddress: true, lastSeenAt: true, location: true, keyRoomId: true },
      orderBy: { name: "asc" },
    }),
    db.networkClient.findMany({
      where: accountFilter,
      select: {
        id: true,
        name: true,
        type: true,
        ipAddress: true,
        lastSeenAt: true,
        keyRoomId: true,
        area: { select: { name: true } },
        device: { select: { keyRoomId: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Netzwerk je Raum: ausdruecklich zugeordnet, sonst erraten ueber den
  // Standort/Bereich (heisst wie der Raum) oder das verknuepfte IoT-Geraet.
  const roomByName = new Map(rooms.map((r) => [r.name.trim().toLowerCase(), r.id]));
  const byName = (name: string | null | undefined) => (name ? roomByName.get(name.trim().toLowerCase()) ?? null : null);
  const network: NetworkItem[] = [
    ...netDevices.map((d) => {
      const guess = byName(d.location);
      return {
        key: `d${d.id}`,
        kind: "device" as const,
        id: d.id,
        name: d.name,
        type: d.type,
        ipAddress: d.ipAddress,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        roomId: d.keyRoomId ?? guess,
        inferred: d.keyRoomId == null && guess != null,
      };
    }),
    ...netClients.map((c) => {
      const guess = c.device?.keyRoomId ?? byName(c.area?.name);
      return {
        key: `c${c.id}`,
        kind: "client" as const,
        id: c.id,
        name: c.name,
        type: c.type,
        ipAddress: c.ipAddress,
        lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
        roomId: c.keyRoomId ?? guess,
        inferred: c.keyRoomId == null && guess != null,
      };
    }),
  ];

  // Personen heute je Raum (Kameras mit Raum). Laeuft nach dem ersten Block,
  // weil die Zeitzone des Mandanten gebraucht wird.
  const tz = account?.timezone || DEFAULT_TIMEZONE;
  const todayStart = dayStart(now, tz);
  const [personEvents, sightings, motions] = await Promise.all([
    db.cameraEvent.findMany({
      where: { ...accountFilter, type: "PERSON", startedAt: { gte: todayStart }, camera: { keyRoomId: { not: null } } },
      select: { startedAt: true, endedAt: true, camera: { select: { keyRoomId: true } } },
    }),
    db.personSighting.findMany({
      where: { ...accountFilter, seenAt: { gte: todayStart }, camera: { keyRoomId: { not: null } } },
      select: {
        seenAt: true,
        camera: { select: { keyRoomId: true } },
        listedPerson: { select: { name: true, listType: true } },
      },
    }),
    db.roomMotionEvent.findMany({
      where: { ...accountFilter, at: { gte: todayStart } },
      select: { roomId: true, at: true },
    }),
  ]);
  const activity = buildRoomActivity(
    personEvents.map((e) => ({ roomId: e.camera.keyRoomId!, startedAt: e.startedAt, endedAt: e.endedAt })),
    sightings
      .filter((s) => s.camera?.keyRoomId != null)
      .map((s) => ({ roomId: s.camera!.keyRoomId!, seenAt: s.seenAt, person: s.listedPerson })),
    now,
    tz,
    motions,
  );

  const lastEventByRoom = new Map<number, RoomEvent>();
  for (const e of events) {
    const roomId = e.camera.keyRoomId;
    if (roomId == null || lastEventByRoom.has(roomId)) continue;
    lastEventByRoom.set(roomId, {
      cameraId: e.cameraId,
      cameraName: e.camera.name,
      type: e.type,
      startedAt: e.startedAt.toISOString(),
    });
  }

  const roomPanels: RoomPanel[] = rooms.map((room) => ({
    id: room.id,
    name: room.name,
    icon: room.icon,
    number: room.number,
    building: room.building,
    floor: room.floor,
    notes: room.notes,
    devices: room.devices.map(toDevice),
    cameras: room.cameras.map(toCamera),
    zones: room.audioZones.map(toZone),
    locks: room.doors.flatMap((door) =>
      door.locks.map((lock) => {
        const doorLabel = door.doorNumber ? `${door.name} (${door.doorNumber})` : door.name;
        return {
          id: lock.id,
          label: lock.lockNumber ? `${doorLabel} [${lock.lockNumber}]` : doorLabel,
          lockType: lock.lockType,
          deviceId: lock.deviceId,
          deviceName: lock.device?.name ?? null,
        };
      }),
    ),
    doorCount: room.doors.length,
    lastEvent: lastEventByRoom.get(room.id) ?? null,
    rules: room.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      trigger: rule.trigger,
      isActive: rule.isActive,
      lastRunAt: rule.lastRunAt ? rule.lastRunAt.toISOString() : null,
      actionCount: rule._count.actions,
    })),
    climate: room.climate ? climateView(room.climate) : null,
    activity: activity.get(room.id) ?? null,
    schedule: room.operatingSchedule
      ? {
          id: room.operatingSchedule.id,
          name: room.operatingSchedule.name,
          seasons: room.operatingSchedule.seasons.map((season) => ({
            name: season.name,
            startMmDd: season.startMmDd,
            endMmDd: season.endMmDd,
            sortOrder: season.sortOrder,
            periods: season.periods.map((p) => ({
              weekday: p.weekday,
              opensAt: p.opensAt,
              closesAt: p.closesAt,
            })),
          })),
          exceptions: room.operatingSchedule.exceptions.map((e) => ({
            date: e.date,
            closed: e.closed,
            opensAt: e.opensAt,
            closesAt: e.closesAt,
            note: e.note,
          })),
        }
      : null,
  }));

  return (
    <>
      <Header title="Räume" accountName={session.user.accountName} />
      <div className="page-content">
        <RaeumeClient
          data={{
            rooms: roomPanels,
            looseDevices: looseDevices.map(toDevice),
            looseCameras: looseCameras.map(toCamera),
            looseZones: looseZones.map(toZone),
            network,
            scheduleOptions: schedules,
            timezone: tz,
            renderedAt: now.toISOString(),
          }}
          readonly={isSuperAdmin}
        />
      </div>
    </>
  );
}
