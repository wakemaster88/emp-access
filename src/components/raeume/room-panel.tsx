"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CalendarClock,
  Cctv,
  Cpu,
  Lightbulb,
  ListTree,
  Lock,
  Pencil,
  Sprout,
  Thermometer,
  TriangleAlert,
  Users,
  Volume2,
  Wifi,
  Workflow,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DeviceRow } from "@/components/raeume/device-row";
import type { ZoneAction } from "@/components/raeume/zone-row";
import { eventTypeLabel, fmtAgo, shortDeviceName } from "@/components/raeume/shared";
import type { DeviceStatus } from "@/components/raeume/status";
import type {
  RoomDevice,
  NetworkItem,
  RoomPanel as RoomPanelData,
  RoomZone,
} from "@/components/raeume/types";
import { isLatchingSwitchDevice } from "@/lib/device-controls";
import { RoomIcon } from "@/components/raeume/room-icons";
import { NetworkWidget } from "@/components/raeume/network-widget";
import { AutomationWidget } from "@/components/raeume/automation-widget";
import { ScheduleEmpty, ScheduleWidget } from "@/components/raeume/schedule-widget";
import { ActivityChart, CameraTile, ClimateHero, DeviceTile, GroupTile, ZoneCard } from "@/components/raeume/room-widgets";
import { MowerCard, type MowerLive } from "@/components/raeume/mower-card";
import type { MowerAction } from "@/lib/mower";
import { cn } from "@/lib/utils";

const FAN_RE = /l(ü|ue)ft|ventil/i;

/** Geraete, die zum Klima gehoeren: Heizung, Lueftung, Klima, Fuehler. */
const CLIMATE_NAME_RE = /heiz|l(ü|ue)ft|klima|thermo|temperatur|ventil/i;

export interface RoomGroups {
  climate: RoomDevice[];
  light: RoomDevice[];
  mower: RoomDevice[];
  other: RoomDevice[];
}

/** Geraete eines Raums auf die Widgets verteilen. */
export function groupRoomDevices(room: RoomPanelData): RoomGroups {
  const heaterIds = new Set([...(room.climate?.heaterDeviceIds ?? []), ...(room.climate?.fanDeviceIds ?? [])]);
  const groups: RoomGroups = { climate: [], light: [], mower: [], other: [] };
  for (const d of room.devices) {
    if (d.type === "MAMMOTION_MOWER") {
      groups.mower.push(d);
    } else if (
      heaterIds.has(d.id) ||
      d.id === room.climate?.sensorDeviceId ||
      (d.category !== "BELEUCHTUNG" && CLIMATE_NAME_RE.test(d.name))
    ) {
      groups.climate.push(d);
    } else if (d.category === "BELEUCHTUNG") groups.light.push(d);
    else groups.other.push(d);
  }
  return groups;
}

/** Erster Messwert einer Art aus den Fuehlern im Raum. */
function roomReading(devices: RoomDevice[], statuses: Map<number, DeviceStatus>, kind: string): string | null {
  for (const d of devices) {
    const r = statuses.get(d.id)?.readings?.find((x) => x.kind === kind);
    if (r) return r.value;
  }
  return null;
}


/** Ob ein Raum irgendetwas zum Anzeigen hat. */
export function roomHasEquipment(room: RoomPanelData): boolean {
  return room.devices.length + room.zones.length + room.cameras.length + room.locks.length > 0 || !!room.climate;
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 px-0.5">
        <span className="text-muted-foreground">{icon}</span>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h4>
        {action && <span className="ml-auto flex items-center gap-1">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warm" | "live" | "violet" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
        tone === "warm" && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
        tone === "live" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
        tone === "violet" && "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
        tone === "muted" && "bg-muted text-foreground/80",
      )}
    >
      {children}
    </span>
  );
}

const sensorValue = (devices: RoomDevice[], statuses: Map<number, DeviceStatus>, kind: string) =>
  roomReading(devices, statuses, kind);

/** "17,5 °C" → 17.5 */
function parseC(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Ein Raum als Karte im Stil einer Smart-Home-App: Kopf mit Status-Pillen,
 * darunter Klima (Ring), Licht- und Schalter-Kacheln, Beschallung, Kamera,
 * Ereignis-Kurve und uebrige Geraete.
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
  onClimate,
  network = [],
  mowers,
  onMowerAction,
}: {
  room: RoomPanelData;
  /** Netzwerkgeraete in diesem Raum. */
  network?: NetworkItem[];
  statuses: Map<number, DeviceStatus>;
  nowMs: number;
  timezone: string;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
  onZoneAction: (zone: RoomZone, action: ZoneAction) => Promise<string | null>;
  onEdit: () => void;
  onClimate: () => void;
  /** Live-Zustand der Maeher (alle 30 s neu gelesen). */
  mowers?: Map<number, MowerLive>;
  onMowerAction?: (device: RoomDevice, action: MowerAction, planId?: string) => Promise<string | null>;
}) {
  const location = [room.building, room.floor].filter(Boolean).join(" · ");
  const groups = groupRoomDevices(room);
  const sensorIds = new Set(
    groups.climate.filter((d) => d.category === "SENSOR" || d.id === room.climate?.sensorDeviceId).map((d) => d.id),
  );
  const sensors = groups.climate.filter((d) => sensorIds.has(d.id));
  const climateDevices = groups.climate.filter((d) => !sensorIds.has(d.id));
  const liveTemp = parseC(sensorValue(sensors, statuses, "temperature"));
  const tempC = liveTemp ?? room.climate?.lastTempC ?? null;
  const humidity = sensorValue(sensors, statuses, "humidity");
  const showClimate = groups.climate.length > 0 || !!room.climate;
  const isOn = (d: RoomDevice) =>
    statuses.has(d.id) ? statuses.get(d.id)?.output === true : d.type === "HUE_LIGHT" && d.task === 1;
  const lightsOn = groups.light.filter(isOn).length;
  const playing = room.zones.filter((z) => z.isPlaying).length;
  // Bewegungsmelder im Raum: live "erkannt" zaehlt sofort als Anwesenheit.
  const motionReadings = room.devices
    .map((d) => statuses.get(d.id)?.readings?.find((r) => r.kind === "motion"))
    .filter(Boolean);
  const hasMotionSensor = motionReadings.length > 0;
  const present = !!room.activity?.present || motionReadings.some((r) => r!.value === "erkannt");
  const tileable = (d: RoomDevice) => isLatchingSwitchDevice(d);
  const otherTiles = groups.other.filter(tileable);
  const otherRows = groups.other.filter((d) => !tileable(d));
  const lightTiles = groups.light.filter(tileable);
  const lightRows = groups.light.filter((d) => !tileable(d));
  const fanIds = new Set(room.climate?.fanDeviceIds ?? []);
  const heaterIds = new Set(room.climate?.heaterDeviceIds ?? []);
  const isFan = (d: RoomDevice) => fanIds.has(d.id) || (!heaterIds.has(d.id) && FAN_RE.test(d.name));
  const fanTiles = climateDevices.filter((d) => tileable(d) && isFan(d));
  const heatTiles = climateDevices.filter((d) => tileable(d) && !isFan(d));
  const climateRows = climateDevices.filter((d) => !tileable(d));
  const [showAll, setShowAll] = useState(false);
  const mowersMowing = groups.mower.filter((d) => {
    const s = mowers?.get(d.id)?.state ?? d.mower?.state;
    return s?.online && s.status === "MODE_WORKING";
  }).length;
  const group = (title: string, list: RoomDevice[], wide = false) =>
    list.length > 0 && (
      <GroupTile
        title={title}
        devices={list}
        roomName={room.name}
        statuses={statuses}
        readonly={readonly}
        onAction={onAction}
        wide={wide}
      />
    );
  const eventLabel = room.lastEvent ? `${eventTypeLabel(room.lastEvent.type)} ${fmtAgo(room.lastEvent.startedAt, nowMs)}` : null;

  const tiles = (list: RoomDevice[]) =>
    list.length > 0 && (
      <div className="grid grid-cols-2 gap-2">
        {list.map((d) => (
          <DeviceTile key={d.id} device={d} roomName={room.name} status={statuses.get(d.id)} readonly={readonly} onAction={onAction} />
        ))}
      </div>
    );
  const rows = (list: RoomDevice[]) =>
    list.map((d) => (
      <DeviceRow
        key={d.id}
        device={d}
        roomName={room.name}
        status={statuses.get(d.id)}
        nowMs={nowMs}
        readonly={readonly}
        onAction={onAction}
      />
    ));

  return (
    <Card className="overflow-hidden rounded-3xl border-border/70 shadow-sm">
      <CardHeader className="relative space-y-2 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent pb-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-[0_6px_16px_-6px_var(--primary)]">
            <RoomIcon room={room} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-base font-semibold tracking-tight text-foreground">
              {room.name}
              {room.number && <span className="font-mono text-[11px] font-normal text-muted-foreground/70">{room.number}</span>}
            </p>
            {(location || room.doorCount > 0) && (
              <p className="truncate text-[11px] text-muted-foreground">
                {[location, room.doorCount > 0 ? `${room.doorCount} ${room.doorCount === 1 ? "Tür" : "Türen"}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          {!readonly && (
            <button
              type="button"
              onClick={onEdit}
              title="Geräte, Kameras und Beschallung dieses Raums zuordnen"
              className="shrink-0 rounded-full p-2 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-primary"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tempC != null && (
            <Pill>
              <Thermometer className="h-3 w-3" />
              {tempC.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C
            </Pill>
          )}
          {lightsOn > 0 && (
            <Pill tone="warm">
              <Lightbulb className="h-3 w-3" />
              {lightsOn} an
            </Pill>
          )}
          {playing > 0 && (
            <Pill tone="violet">
              <Volume2 className="h-3 w-3" />
              Musik
            </Pill>
          )}
          {mowersMowing > 0 && (
            <Pill tone="live">
              <Sprout className="h-3 w-3" />
              {mowersMowing === 1 ? "Mäher mäht" : `${mowersMowing} Mäher mähen`}
            </Pill>
          )}
          {present && (
            <Pill tone="live">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              jemand da
            </Pill>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-1">
        <Section icon={<CalendarClock className="h-3.5 w-3.5" />} title="Betriebszeit">
          {room.schedule ? (
            <ScheduleWidget schedule={room.schedule} climate={room.climate} timezone={timezone} nowMs={nowMs} />
          ) : (
            <ScheduleEmpty onEdit={readonly ? undefined : onEdit} />
          )}
        </Section>
        {room.automations.length > 0 && (
          <Section
            icon={<Workflow className="h-3.5 w-3.5" />}
            title={`Regeln & Abläufe · ${room.automations.filter((a) => a.isActive).length}`}
            action={
              !readonly && (
                <Link href="/regeln" className="text-[11px] font-medium text-primary hover:underline">
                  Bearbeiten
                </Link>
              )
            }
          >
            <AutomationWidget items={room.automations} nowMs={nowMs} timezone={timezone} />
          </Section>
        )}
        {showClimate && (
          <Section
            icon={<Thermometer className="h-3.5 w-3.5" />}
            title="Klima"
            action={
              !readonly && (
                <button
                  type="button"
                  onClick={onClimate}
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                >
                  {room.climate ? "Einstellen" : "Temperatur halten …"}
                </button>
              )
            }
          >
            <div
              className={cn(
                "rounded-2xl border p-2 pr-3",
                room.climate?.lastError
                  ? "border-destructive/40 bg-destructive/5"
                  : room.climate?.heating
                    ? "border-orange-300/50 bg-gradient-to-br from-orange-50 to-transparent dark:border-orange-400/20 dark:from-orange-500/10"
                    : "border-border bg-gradient-to-br from-sky-50/70 to-transparent dark:from-sky-500/5",
              )}
            >
              <ClimateHero tempC={tempC} humidity={humidity} climate={room.climate} nowMs={nowMs} />
              {room.climate?.lastError && (
                <p className="flex items-center gap-1 px-1 pb-1 text-[11px] text-destructive">
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  {room.climate.lastError}
                </p>
              )}
              {(heatTiles.length > 0 || fanTiles.length > 0) && (
                <div className="mt-2 grid grid-cols-2 gap-2 pl-1">
                  {group("Heizung", heatTiles)}
                  {group("Belüftung", fanTiles)}
                </div>
              )}
              {climateRows.length > 0 && <div className="mt-2 space-y-1.5 pl-1">{rows(climateRows)}</div>}
            </div>
          </Section>
        )}

        {groups.light.length > 0 && (
          <Section
            icon={<Lightbulb className="h-3.5 w-3.5" />}
            title="Beleuchtung"
          >
            {lightTiles.length > 0 && <div className="grid grid-cols-2 gap-2">{group("Alle Lichter", lightTiles, true)}</div>}
            {rows(lightRows)}
          </Section>
        )}

        {groups.mower.length > 0 && (
          <Section icon={<Sprout className="h-3.5 w-3.5" />} title="Mähroboter">
            <div className="space-y-2">
              {groups.mower.map((d) => (
                <MowerCard
                  key={d.id}
                  device={d}
                  map={d.mower?.map ?? null}
                  initial={d.mower?.state ?? null}
                  live={mowers?.get(d.id)}
                  nowMs={nowMs}
                  timezone={timezone}
                  readonly={readonly || !onMowerAction}
                  onAction={onMowerAction ?? (async () => "Nicht verfügbar")}
                />
              ))}
            </div>
          </Section>
        )}

        {room.zones.length > 0 && (
          <Section icon={<Volume2 className="h-3.5 w-3.5" />} title="Beschallung">
            <div className="space-y-2">
              {room.zones.map((zone) => (
                <ZoneCard key={zone.id} zone={zone} nowMs={nowMs} readonly={readonly} onAction={onZoneAction} />
              ))}
            </div>
          </Section>
        )}

        {room.cameras.length > 0 && (
          <Section icon={<Cctv className="h-3.5 w-3.5" />} title="Überwachung">
            <div className="grid grid-cols-2 gap-2">
              {room.cameras.map((camera, i) => (
                <CameraTile
                  key={camera.id}
                  camera={camera}
                  nowMs={nowMs}
                  wide={room.cameras.length === 1 || (room.cameras.length % 2 === 1 && i === 0)}
                  eventLabel={room.lastEvent?.cameraId === camera.id ? eventLabel : null}
                />
              ))}
            </div>
          </Section>
        )}

        {(room.activity || room.cameras.length > 0 || hasMotionSensor) && (
          <Section
            icon={<Users className="h-3.5 w-3.5" />}
            title="Ereignisse"
            action={
              present ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  gerade jemand da
                </span>
              ) : room.activity?.lastAt ? (
                <span className="text-[11px] text-muted-foreground">zuletzt {fmtAgo(room.activity.lastAt, nowMs)}</span>
              ) : null
            }
          >
            <div className="rounded-2xl border border-border bg-gradient-to-b from-primary/[0.04] to-transparent p-3">
              <ActivityChart activity={room.activity} nowMs={nowMs} timezone={timezone} />
            </div>
          </Section>
        )}

        {groups.other.length > 0 && (
          <Section icon={<Cpu className="h-3.5 w-3.5" />} title="Geräte">
            {tiles(otherTiles)}
            {rows(otherRows)}
          </Section>
        )}

        {network.length > 0 && (
          <Section icon={<Wifi className="h-3.5 w-3.5" />} title="Netzwerk">
            <NetworkWidget items={network} nowMs={nowMs} />
          </Section>
        )}

        {room.devices.length > 0 && (
          <Section
            icon={<ListTree className="h-3.5 w-3.5" />}
            title={`Alle Geräte & Sensoren · ${room.devices.length}`}
            action={
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              >
                {showAll ? "Ausblenden" : "Anzeigen"}
              </button>
            }
          >
            {showAll ? (
              <div className="space-y-1.5">{rows(room.devices)}</div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="flex w-full flex-wrap gap-1.5 rounded-2xl border border-dashed border-border p-2 text-left"
              >
                {room.devices.map((d) => {
                  const s = statuses.get(d.id);
                  const reading = s?.readings?.[0];
                  return (
                    <span
                      key={d.id}
                      className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px]"
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          s ? (s.online ? (s.output ? "bg-emerald-500" : "bg-slate-400") : "bg-destructive") : "bg-slate-300",
                        )}
                      />
                      <span className="truncate">{shortDeviceName(d.name, room.name)}</span>
                      {reading && <span className="shrink-0 text-muted-foreground">{reading.value}</span>}
                    </span>
                  );
                })}
              </button>
            )}
          </Section>
        )}

        {room.locks.length > 0 && (
          <Section icon={<Lock className="h-3.5 w-3.5" />} title="Schließung">
            {room.locks.map((lock) => (
              <div key={lock.id} className="flex items-center gap-1.5 rounded-xl bg-muted/50 px-2.5 py-1.5 text-[11px]">
                <span className="min-w-0 break-words text-muted-foreground">{lock.label}</span>
                {lock.deviceName && (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-primary" title="Wird elektronisch geöffnet">
                    <Zap className="h-2.5 w-2.5" />
                    {lock.deviceName}
                  </span>
                )}
              </div>
            ))}
          </Section>
        )}
      </CardContent>
    </Card>
  );
}
