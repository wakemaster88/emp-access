"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Cctv, Cpu, Plus, Search, TriangleAlert, Volume2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { RoomPanel, roomHasEquipment } from "@/components/raeume/room-panel";
import { RoomIcon } from "@/components/raeume/room-icons";
import { ClimateDialog } from "@/components/raeume/climate-dialog";
import { RoomEquipmentDialog, type Placed } from "@/components/raeume/room-equipment-dialog";
import { ErrorLine, apiRequest, deviceMetaLabel } from "@/components/raeume/shared";
import { useDeviceStatuses, useNow } from "@/components/raeume/status";
import { useMowerStates } from "@/components/raeume/mower-card";
import type { MowerAction } from "@/lib/mower";
import type { ZoneAction } from "@/components/raeume/zone-row";
import type { NetworkItem, RaeumeData, RoomCamera, RoomDevice, RoomZone } from "@/components/raeume/types";

/** Wartezeit, bevor nach einer Schaltaktion neu abgefragt wird. */
const STATUS_SETTLE_MS = 1200;

/**
 * Der Abspieler meldet den neuen Zustand erst mit dem naechsten Heartbeat;
 * so lange warten, bevor die Seite neu laedt.
 */
const ZONE_SETTLE_MS = 2500;

export function RaeumeClient({ data, readonly }: { data: RaeumeData; readonly: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [equipmentRoom, setEquipmentRoom] = useState<{
    id: number;
    name: string;
    icon: string | null;
    scheduleId: number | null;
  } | null>(null);
  const [climateRoomId, setClimateRoomId] = useState<number | null>(null);
  const [error, setError] = useState("");

  // Nur Shelly-Geraete haben eine Statusabfrage. Geraete ohne Raum bleiben
  // aussen vor: dort geht es ums Zuordnen, nicht ums Schalten.
  const shellyIds = useMemo(
    () =>
      data.rooms
        .flatMap((room) => room.devices)
        .filter((device) => device.type === "SHELLY")
        .map((device) => device.id),
    [data.rooms],
  );
  const { statuses, refresh } = useDeviceStatuses(shellyIds);
  const nowMs = useNow(new Date(data.renderedAt).getTime());
  const hasMowers = useMemo(
    () => data.rooms.some((room) => room.devices.some((device) => device.type === "MAMMOTION_MOWER")),
    [data.rooms],
  );
  const { live: mowers, refreshSoon: refreshMowers } = useMowerStates(hasMowers);

  const placedDevices: Placed<RoomDevice>[] = useMemo(
    () => [
      ...data.rooms.flatMap((room) => room.devices.map((item) => ({ item, roomId: room.id }))),
      ...data.looseDevices.map((item) => ({ item, roomId: null })),
    ],
    [data.rooms, data.looseDevices],
  );
  const placedCameras: Placed<RoomCamera>[] = useMemo(
    () => [
      ...data.rooms.flatMap((room) => room.cameras.map((item) => ({ item, roomId: room.id }))),
      ...data.looseCameras.map((item) => ({ item, roomId: null })),
    ],
    [data.rooms, data.looseCameras],
  );
  const placedZones: Placed<RoomZone>[] = useMemo(
    () => [
      ...data.rooms.flatMap((room) => room.zones.map((item) => ({ item, roomId: room.id }))),
      ...data.looseZones.map((item) => ({ item, roomId: null })),
    ],
    [data.rooms, data.looseZones],
  );
  const allShellys = useMemo(
    () => placedDevices.map((p) => p.item).filter((d) => d.type === "SHELLY"),
    [placedDevices],
  );
  const roomNames = useMemo(
    () => new Map(data.rooms.map((room) => [room.id, room.name])),
    [data.rooms],
  );

  const visibleRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.rooms;
    return data.rooms.filter((room) => {
      const haystack = [
        room.name,
        room.number,
        room.building,
        room.floor,
        ...room.devices.map((d) => d.name),
        ...room.cameras.map((c) => c.name),
        ...room.zones.map((z) => z.name),
      ];
      return haystack.some((v) => v?.toLowerCase().includes(q));
    });
  }, [data.rooms, query]);

  async function handleAction(device: RoomDevice, action: string): Promise<string | null> {
    setError("");
    const res = await apiRequest<{ error?: string }>(
      `/api/devices/${device.id}/action`,
      "POST",
      { action },
    );
    if (!res.ok) return res.message;
    // Der Endpunkt meldet 200 auch dann, wenn der Befehl das Gerät nicht
    // erreicht hat – die Ursache steht dann in `error`.
    const remoteError = res.data?.error;
    setTimeout(refresh, STATUS_SETTLE_MS);
    // Hue: Zustand ist der letzte Befehl; die Seite neu laden, sobald der Hub geschaltet hat.
    if (device.type === "HUE_LIGHT") setTimeout(() => router.refresh(), 6_000);
    return remoteError ?? null;
  }

  async function handleMowerAction(device: RoomDevice, action: MowerAction, planId?: string): Promise<string | null> {
    setError("");
    const res = await apiRequest<{ error?: string }>(`/api/devices/${device.id}/mower`, "POST", { action, planId });
    if (!res.ok) return res.message;
    refreshMowers();
    return null;
  }

  async function handleZoneAction(zone: RoomZone, action: ZoneAction): Promise<string | null> {
    setError("");
    const res = await apiRequest<{ error?: string }>(
      `/api/audio/zones/${zone.id}/control`,
      "POST",
      { action },
    );
    if (!res.ok) return res.message;
    setTimeout(() => router.refresh(), ZONE_SETTLE_MS);
    return null;
  }

  const networkByRoom = new Map<number, NetworkItem[]>();
  for (const item of data.network) {
    if (item.roomId != null) networkByRoom.set(item.roomId, [...(networkByRoom.get(item.roomId) ?? []), item]);
  }
  const equipped = (room: (typeof data.rooms)[number]) => roomHasEquipment(room) || networkByRoom.has(room.id);
  const equippedRooms = visibleRooms.filter(equipped);
  const emptyRooms = visibleRooms.filter((room) => !equipped(room));
  const climateRoom = climateRoomId != null ? data.rooms.find((r) => r.id === climateRoomId) ?? null : null;
  const openEquipment = (room: (typeof data.rooms)[number]) =>
    setEquipmentRoom({ id: room.id, name: room.name, icon: room.icon, scheduleId: room.schedule?.id ?? null });

  const deviceCount = data.rooms.reduce((sum, r) => sum + r.devices.length, 0);
  const cameraCount = data.rooms.reduce((sum, r) => sum + r.cameras.length, 0);
  const zoneCount = data.rooms.reduce((sum, r) => sum + r.zones.length, 0);
  const looseCount = data.looseDevices.length + data.looseCameras.length + data.looseZones.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base sm:text-xl">
                {data.rooms.length} Räume · {deviceCount} Geräte · {cameraCount} Kameras
                {zoneCount > 0 && ` · ${zoneCount} Beschallungszonen`}
              </CardTitle>
              <CardDescription>
                Steuerung je Raum. Räume, Türen und Schlösser werden in der{" "}
                <Link href="/schliessanlage" className="underline hover:text-primary">
                  Schließanlage
                </Link>{" "}
                gepflegt.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Raum oder Gerät suchen…"
                className="h-9 w-full rounded-md border border-border bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring dark:border-border dark:bg-card"
              />
            </div>
          </div>
          <ErrorLine message={error} />
        </CardHeader>

        {looseCount > 0 && (
          <CardContent className="pt-0">
            <div className="rounded-md border border-dashed border-warning/30 bg-warning/10 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                Noch keinem Raum zugeordnet
              </p>
              <p className="mt-1 text-[11px] text-warning/80">
                {data.looseDevices.length} Geräte, {data.looseCameras.length} Kameras und{" "}
                {data.looseZones.length} Beschallungszonen erscheinen erst in einem Raum, wenn du
                sie dort zuordnest. Das geht über den Stift an einer Raumkarte. Erst mit Raum
                bekommen sie eine Betriebszeit.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {data.looseDevices.slice(0, 12).map((device) => (
                  <span
                    key={`d${device.id}`}
                    title={deviceMetaLabel(device.type, device.category)}
                    className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-muted dark:text-foreground/80"
                  >
                    <Cpu className="h-2.5 w-2.5 text-muted-foreground/70" />
                    {device.name}
                  </span>
                ))}
                {data.looseCameras.slice(0, 6).map((camera) => (
                  <span
                    key={`c${camera.id}`}
                    className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-muted dark:text-foreground/80"
                  >
                    <Cctv className="h-2.5 w-2.5 text-muted-foreground/70" />
                    {camera.name}
                  </span>
                ))}
                {data.looseZones.slice(0, 6).map((zone) => (
                  <span
                    key={`z${zone.id}`}
                    className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-muted dark:text-foreground/80"
                  >
                    <Volume2 className="h-2.5 w-2.5 text-muted-foreground/70" />
                    {zone.name}
                  </span>
                ))}
                {data.looseDevices.length > 12 && (
                  <span className="text-[10px] text-muted-foreground/70">
                    und {data.looseDevices.length - 12} weitere
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {data.rooms.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={Building2}
            title="Noch keine Räume angelegt"
            description="Räume, Türen und Schlösser werden in der Schließanlage gepflegt und erscheinen dann hier als Leitstand."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/schliessanlage">In der Schließanlage anlegen</Link>
              </Button>
            }
          />
        </Card>
      ) : visibleRooms.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground/70">Keine Treffer.</p>
      ) : (
        <>
          {equippedRooms.length > 0 && (
            <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {equippedRooms.map((room) => (
                <RoomPanel
                  key={room.id}
                  room={room}
                  statuses={statuses}
                  nowMs={nowMs}
                  timezone={data.timezone}
                  readonly={readonly}
                  onAction={handleAction}
                  onZoneAction={handleZoneAction}
                  onEdit={() => openEquipment(room)}
                  onClimate={() => setClimateRoomId(room.id)}
                  network={networkByRoom.get(room.id) ?? []}
                  mowers={mowers}
                  onMowerAction={handleMowerAction}
                />
              ))}
            </div>
          )}
          {(emptyRooms.length > 0 || !readonly) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Räume ohne Ausstattung</CardTitle>
                <CardDescription className="text-xs">
                  Noch keine Geräte, Kameras oder Beschallung zugeordnet. Antippen zum Ausstatten.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {emptyRooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    disabled={readonly}
                    onClick={() => openEquipment(room)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary disabled:pointer-events-none"
                  >
                    <RoomIcon room={room} className="h-3 w-3" />
                    {room.name}
                    {(room.building || room.floor) && (
                      <span className="text-muted-foreground/60">{[room.building, room.floor].filter(Boolean).join(" · ")}</span>
                    )}
                  </button>
                ))}
                {!readonly && <NewRoomButton />}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {climateRoom && (
        <ClimateDialog
          roomId={climateRoom.id}
          roomName={climateRoom.name}
          roomScheduleName={climateRoom.schedule?.name ?? null}
          climate={climateRoom.climate}
          roomDevices={climateRoom.devices}
          allShellys={allShellys}
          scheduleOptions={data.scheduleOptions}
          onClose={() => setClimateRoomId(null)}
        />
      )}

      {equipmentRoom && (
        <RoomEquipmentDialog
          roomId={equipmentRoom.id}
          roomName={equipmentRoom.name}
          devices={placedDevices}
          cameras={placedCameras}
          zones={placedZones}
          roomNames={roomNames}
          scheduleOptions={data.scheduleOptions}
          currentScheduleId={equipmentRoom.scheduleId}
          roomIcon={equipmentRoom.icon}
          network={data.network}
          open
          onClose={() => setEquipmentRoom(null)}
        />
      )}
    </div>
  );
}

/** Neuen Raum direkt aus der Raumuebersicht anlegen. */
function NewRoomButton() {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await apiRequest("/api/schliessanlage/rooms", "POST", { name: name.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setName("");
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
      >
        <Plus className="h-3 w-3" />
        Neuer Raum
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="Name, z. B. Büro"
        maxLength={120}
        className="h-7 w-40 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || !name.trim()}
        className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "…" : "Anlegen"}
      </button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </span>
  );
}
