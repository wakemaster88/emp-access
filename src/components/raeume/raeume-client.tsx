"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Cctv, Cpu, Search, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RoomPanel } from "@/components/raeume/room-panel";
import { RoomEquipmentDialog, type Placed } from "@/components/raeume/room-equipment-dialog";
import { ErrorLine, apiRequest, deviceMetaLabel } from "@/components/raeume/shared";
import { useDeviceStatuses, useNow } from "@/components/raeume/status";
import type { RaeumeData, RoomCamera, RoomDevice } from "@/components/raeume/types";

/** Wartezeit, bevor nach einer Schaltaktion neu abgefragt wird. */
const STATUS_SETTLE_MS = 1200;

export function RaeumeClient({ data, readonly }: { data: RaeumeData; readonly: boolean }) {
  const [query, setQuery] = useState("");
  const [equipmentRoom, setEquipmentRoom] = useState<{ id: number; name: string } | null>(null);
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

  const deviceCount = data.rooms.reduce((sum, r) => sum + r.devices.length, 0);
  const cameraCount = data.rooms.reduce((sum, r) => sum + r.cameras.length, 0);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base sm:text-xl">
                {data.rooms.length} Räume · {deviceCount} Geräte · {cameraCount} Kameras
              </CardTitle>
              <CardDescription>
                Steuerung je Raum. Räume, Türen und Schlösser werden in der{" "}
                <Link href="/schliessanlage" className="underline hover:text-indigo-500">
                  Schließanlage
                </Link>{" "}
                gepflegt.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Raum oder Gerät suchen…"
                className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
          </div>
          <ErrorLine message={error} />
        </CardHeader>

        {(data.looseDevices.length > 0 || data.looseCameras.length > 0) && (
          <CardContent className="pt-0">
            <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/10">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                Noch keinem Raum zugeordnet
              </p>
              <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
                {data.looseDevices.length} Geräte und {data.looseCameras.length} Kameras erscheinen
                erst in einem Raum, wenn du sie dort zuordnest. Das geht über den Stift an einer
                Raumkarte.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {data.looseDevices.slice(0, 12).map((device) => (
                  <span
                    key={`d${device.id}`}
                    title={deviceMetaLabel(device.type, device.category)}
                    className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Cpu className="h-2.5 w-2.5 text-slate-400" />
                    {device.name}
                  </span>
                ))}
                {data.looseCameras.slice(0, 6).map((camera) => (
                  <span
                    key={`c${camera.id}`}
                    className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Cctv className="h-2.5 w-2.5 text-slate-400" />
                    {camera.name}
                  </span>
                ))}
                {data.looseDevices.length > 12 && (
                  <span className="text-[10px] text-slate-400">
                    und {data.looseDevices.length - 12} weitere
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {data.rooms.length === 0 ? (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Noch keine Räume angelegt.
            </p>
            <Link
              href="/schliessanlage"
              className="mt-1 inline-block text-xs text-indigo-500 underline"
            >
              In der Schließanlage anlegen
            </Link>
          </CardContent>
        </Card>
      ) : visibleRooms.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">Keine Treffer.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleRooms.map((room) => (
            <RoomPanel
              key={room.id}
              room={room}
              statuses={statuses}
              nowMs={nowMs}
              readonly={readonly}
              onAction={handleAction}
              onEdit={() => setEquipmentRoom({ id: room.id, name: room.name })}
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
          roomNames={roomNames}
          open
          onClose={() => setEquipmentRoom(null)}
        />
      )}
    </div>
  );
}
