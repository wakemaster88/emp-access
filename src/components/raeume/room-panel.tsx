"use client";

import { Building2, Cctv, Lock, Pencil, Radio, Zap } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DeviceRow } from "@/components/raeume/device-row";
import { eventTypeLabel, fmtAgo } from "@/components/raeume/shared";
import type { DeviceStatus } from "@/components/raeume/status";
import type { RoomDevice, RoomPanel as RoomPanelData } from "@/components/raeume/types";
import { cn } from "@/lib/utils";

/**
 * Ein Raum als Leitstand-Karte: Geraete zum Schalten, Kameras mit letztem Bild,
 * Schliesspunkte aus der Schliessanlage. Die Karte ist der Ort, an dem spaeter
 * auch die Regeln des Raums stehen.
 */
export function RoomPanel({
  room,
  statuses,
  nowMs,
  readonly,
  onAction,
  onEdit,
}: {
  room: RoomPanelData;
  statuses: Map<number, DeviceStatus>;
  nowMs: number;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
  onEdit: () => void;
}) {
  const location = [room.building, room.floor].filter(Boolean).join(" · ");
  const anythingOn = room.devices.some((d) => statuses.get(d.id)?.output === true);

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              anythingOn
                ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
                : "bg-indigo-50 text-indigo-500 dark:bg-indigo-950/30",
            )}
          >
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
              {room.name}
              {room.number && (
                <span className="font-mono text-[11px] font-normal text-slate-400">
                  {room.number}
                </span>
              )}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {location || "ohne Gebäudeangabe"}
              {room.doorCount > 0 && (
                <span>
                  {" · "}
                  {room.doorCount} {room.doorCount === 1 ? "Tür" : "Türen"}
                </span>
              )}
            </p>
          </div>
          {!readonly && (
            <button
              type="button"
              onClick={onEdit}
              title="Geräte und Kameras dieses Raums zuordnen"
              className="shrink-0 p-1 text-slate-400 hover:text-indigo-500"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {room.lastEvent && (
          <p className="mt-2 flex items-center gap-1.5 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <Radio className="h-3 w-3 shrink-0 text-sky-500" />
            {eventTypeLabel(room.lastEvent.type)} {fmtAgo(room.lastEvent.startedAt, nowMs)}
            <span className="truncate text-slate-400">· {room.lastEvent.cameraName}</span>
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {room.devices.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 py-4 text-center text-[11px] text-slate-400 dark:border-slate-700">
            Noch kein Gerät in diesem Raum.
          </p>
        ) : (
          <div className="space-y-1.5">
            {room.devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                status={statuses.get(device.id)}
                nowMs={nowMs}
                readonly={readonly}
                onAction={onAction}
              />
            ))}
          </div>
        )}

        {room.cameras.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5">
            {room.cameras.map((camera) => (
              <div
                key={camera.id}
                className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
              >
                <div className="relative flex aspect-video items-center justify-center bg-slate-100 dark:bg-slate-900">
                  {camera.snapshotAt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/cameras/${camera.id}/snapshot?t=${encodeURIComponent(camera.snapshotAt)}`}
                      alt={`Schnappschuss ${camera.name}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Cctv className="h-6 w-6 text-slate-300 dark:text-slate-600" />
                  )}
                </div>
                <div className="flex items-center gap-1 px-1.5 py-1">
                  <span className="truncate text-[10px] text-slate-600 dark:text-slate-300">
                    {camera.name}
                  </span>
                  <span
                    className="ml-auto shrink-0 text-[10px] text-slate-400"
                    title={
                      camera.snapshotAt ? `Bild von ${fmtAgo(camera.snapshotAt, nowMs)}` : undefined
                    }
                  >
                    {camera.enabled ? fmtAgo(camera.snapshotAt, nowMs) : "aus"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {room.locks.length > 0 && (
          <div className="space-y-1">
            {room.locks.map((lock) => (
              <div
                key={lock.id}
                className="flex items-center gap-1.5 rounded bg-slate-50 px-2 py-1 text-[11px] dark:bg-slate-800/50"
              >
                <Lock className="h-3 w-3 shrink-0 text-slate-400" />
                <span className="truncate text-slate-600 dark:text-slate-300">{lock.label}</span>
                {lock.deviceName && (
                  <span
                    className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-indigo-500"
                    title="Wird elektronisch geöffnet"
                  >
                    <Zap className="h-2.5 w-2.5" />
                    {lock.deviceName}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
