"use client";

import Link from "next/link";
import {
  Building2,
  Cctv,
  DoorClosed,
  DoorOpen,
  Lock,
  Pencil,
  Radio,
  Workflow,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DeviceRow } from "@/components/raeume/device-row";
import { ZoneRow, type ZoneAction } from "@/components/raeume/zone-row";
import { eventTypeLabel, fmtAgo } from "@/components/raeume/shared";
import { triggerLabel } from "@/components/regeln/shared";
import type { DeviceStatus } from "@/components/raeume/status";
import type {
  RoomDevice,
  RoomPanel as RoomPanelData,
  RoomZone,
} from "@/components/raeume/types";
import { describeDay, isOperatingAt, openingForDay } from "@/lib/operating-hours";
import { tzYmd } from "@/lib/tz-time";
import { cn } from "@/lib/utils";

/**
 * Betriebszustand des Raums als Zeile: geoeffnet oder geschlossen, dazu die
 * Zeiten von heute. Ohne Profil bleibt die Zeile weg – dann steuert nichts
 * anderes als die Regeln selbst.
 */
function OperatingLine({
  schedule,
  timezone,
  nowMs,
}: {
  schedule: NonNullable<RoomPanelData["schedule"]>;
  timezone: string;
  nowMs: number;
}) {
  const now = new Date(nowMs);
  const spec = { name: schedule.name, seasons: schedule.seasons, exceptions: schedule.exceptions };
  const open = isOperatingAt(spec, now, timezone);
  const today = openingForDay(spec, tzYmd(now, timezone));

  return (
    <p
      className={cn(
        "mt-2 flex items-center gap-1.5 rounded px-2 py-1 text-[11px]",
        open
          ? "bg-success/10 text-success "
          : "bg-muted/50 text-muted-foreground dark:bg-muted/50 dark:text-muted-foreground",
      )}
      title={`Betriebszeit: ${schedule.name}`}
    >
      {open ? (
        <DoorOpen className="h-3 w-3 shrink-0" />
      ) : (
        <DoorClosed className="h-3 w-3 shrink-0" />
      )}
      {open ? "geöffnet" : "geschlossen"}
      <span className="truncate opacity-70">
        · {schedule.name} · heute {describeDay(today)}
      </span>
    </p>
  );
}

/**
 * Ein Raum als Leitstand-Karte: Geraete zum Schalten, Beschallung mit
 * Start/Stopp, Kameras mit letztem Bild, Schliesspunkte aus der
 * Schliessanlage und die Regeln, die hier greifen.
 */
export function RoomPanel({
  room,
  statuses,
  nowMs,
  timezone,
  readonly,
  onAction,
  onZoneAction,
  onEdit,
}: {
  room: RoomPanelData;
  statuses: Map<number, DeviceStatus>;
  nowMs: number;
  timezone: string;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
  onZoneAction: (zone: RoomZone, action: ZoneAction) => Promise<string | null>;
  onEdit: () => void;
}) {
  const location = [room.building, room.floor].filter(Boolean).join(" · ");
  const anythingOn = room.devices.some((d) => statuses.get(d.id)?.output === true);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              anythingOn
                ? "bg-warning/10 text-warning "
                : "bg-primary/10 text-primary ",
            )}
          >
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground/90">
              {room.name}
              {room.number && (
                <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                  {room.number}
                </span>
              )}
            </p>
            <p className="truncate text-[11px] text-muted-foreground/70">
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
              title="Geräte, Kameras und Beschallung dieses Raums zuordnen"
              className="shrink-0 p-1 text-muted-foreground/70 hover:text-primary"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {room.schedule && (
          <OperatingLine schedule={room.schedule} timezone={timezone} nowMs={nowMs} />
        )}

        {room.lastEvent && (
          <p className="mt-2 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground dark:bg-muted/50 dark:text-muted-foreground">
            <Radio className="h-3 w-3 shrink-0 text-info" />
            {eventTypeLabel(room.lastEvent.type)} {fmtAgo(room.lastEvent.startedAt, nowMs)}
            <span className="truncate text-muted-foreground/70">· {room.lastEvent.cameraName}</span>
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {room.devices.length === 0 && room.zones.length === 0 ? (
          <p className="rounded-md border border-dashed border-border py-4 text-center text-[11px] text-muted-foreground/70 dark:border-border">
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
            {room.zones.map((zone) => (
              <ZoneRow
                key={`zone-${zone.id}`}
                zone={zone}
                nowMs={nowMs}
                readonly={readonly}
                onAction={onZoneAction}
              />
            ))}
          </div>
        )}

        {room.cameras.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5">
            {room.cameras.map((camera) => (
              <div
                key={camera.id}
                className="overflow-hidden rounded-md border border-border"
              >
                <div className="relative flex aspect-video items-center justify-center bg-muted dark:bg-card">
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
                  <span className="truncate text-[10px] text-muted-foreground">
                    {camera.name}
                  </span>
                  <span
                    className="ml-auto shrink-0 text-[10px] text-muted-foreground/70"
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

        {room.rules.length > 0 && (
          <div className="space-y-1">
            {room.rules.map((rule) => (
              <Link
                key={rule.id}
                href="/regeln"
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] hover:bg-muted",
                  rule.isActive ? "" : "opacity-50",
                )}
                title={
                  rule.isActive
                    ? `Zuletzt ausgelöst: ${fmtAgo(rule.lastRunAt, nowMs)}`
                    : "Regel ist pausiert"
                }
              >
                <Workflow className="h-3 w-3 shrink-0 text-violet-500" />
                <span className="truncate text-muted-foreground">{rule.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground/70">
                  {triggerLabel(rule.trigger)}
                </span>
              </Link>
            ))}
          </div>
        )}

        {room.locks.length > 0 && (
          <div className="space-y-1">
            {room.locks.map((lock) => (
              <div
                key={lock.id}
                className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-[11px] dark:bg-muted/50"
              >
                <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                <span className="truncate text-muted-foreground">{lock.label}</span>
                {lock.deviceName && (
                  <span
                    className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-primary"
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
