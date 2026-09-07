"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Cctv, Cpu, Search, TriangleAlert, Volume2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { RoomPanel } from "@/components/raeume/room-panel";
import { RoomEquipmentDialog, type Placed } from "@/components/raeume/room-equipment-dialog";
import { ErrorLine, apiRequest, deviceMetaLabel } from "@/components/raeume/shared";
import { useDeviceStatuses, useNow } from "@/components/raeume/status";
import type { ZoneAction } from "@/components/raeume/zone-row";
import type { RaeumeData, RoomCamera, RoomDevice, RoomZone } from "@/components/raeume/types";

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
    scheduleId: number | null;
  } | null>(null);
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
    return remoteError ?? null;
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
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleRooms.map((room) => (
            <RoomPanel
              key={room.id}
              room={room}
              statuses={statuses}
              nowMs={nowMs}
              timezone={data.timezone}
              readonly={readonly}
              onAction={handleAction}
              onZoneAction={handleZoneAction}
              onEdit={() =>
                setEquipmentRoom({
                  id: room.id,
                  name: room.name,
                  scheduleId: room.schedule?.id ?? null,
                })
              }
            />
          ))}
        </div>
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
          open
          onClose={() => setEquipmentRoom(null)}
        />
      )}
    </div>
  );
}
