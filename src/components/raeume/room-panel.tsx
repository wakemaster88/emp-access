"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Building2,
  Cctv,
  Cpu,
  DoorClosed,
  DoorOpen,
  Flame,
  Lightbulb,
  Loader2,
  Lock,
  Pencil,
  Radio,
  Thermometer,
  TriangleAlert,
  Users,
  Volume2,
  Workflow,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
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
import { isLatchingSwitchDevice } from "@/lib/device-controls";
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

/** Geraete, die zum Klima gehoeren: Heizung, Lueftung, Klima, Fuehler. */
const CLIMATE_NAME_RE = /heiz|l(ü|ue)ft|klima|thermo|temperatur|ventil/i;

export interface RoomGroups {
  climate: RoomDevice[];
  light: RoomDevice[];
  other: RoomDevice[];
}

/** Geraete eines Raums auf die Widgets verteilen. */
export function groupRoomDevices(room: RoomPanelData): RoomGroups {
  const heaterIds = new Set(room.climate?.heaterDeviceIds ?? []);
  const groups: RoomGroups = { climate: [], light: [], other: [] };
  for (const d of room.devices) {
    if (
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

function fmtC(v: number | null | undefined, digits = 1): string {
  return v == null ? "–" : `${v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} °C`;
}

/** Erster Messwert einer Art aus den Fuehlern im Raum. */
function roomReading(devices: RoomDevice[], statuses: Map<number, DeviceStatus>, kind: string): string | null {
  for (const d of devices) {
    const r = statuses.get(d.id)?.readings?.find((x) => x.kind === kind);
    if (r) return r.value;
  }
  return null;
}

function Widget({
  icon,
  title,
  tone = "default",
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  tone?: "default" | "active" | "warn";
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border p-2",
        tone === "active"
          ? "border-warning/30 bg-warning/5"
          : tone === "warn"
            ? "border-destructive/30 bg-destructive/5"
            : "border-border bg-muted/20",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <span className="text-muted-foreground">{icon}</span>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        {action && <span className="ml-auto flex items-center gap-1">{action}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function ClimateSummary({
  room,
  devices,
  statuses,
  nowMs,
}: {
  room: RoomPanelData;
  devices: RoomDevice[];
  statuses: Map<number, DeviceStatus>;
  nowMs: number;
}) {
  const c = room.climate;
  const live = roomReading(devices, statuses, "temperature");
  const humidity = roomReading(devices, statuses, "humidity");
  const temp = live ?? (c?.lastTempC != null ? fmtC(c.lastTempC) : null);
  return (
    <div className="flex items-end gap-3 px-0.5">
      <div>
        <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">{temp ?? "–"}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {humidity ? `Luftfeuchte ${humidity}` : temp ? "Raumtemperatur" : "kein Fühler im Raum"}
        </p>
      </div>
      {c && (
        <div className="ml-auto text-right text-[11px] leading-tight text-muted-foreground">
          {!c.isActive ? (
            <p>Regelung pausiert</p>
          ) : (
            <>
              <p>
                Soll{" "}
                <span className="font-medium text-foreground">
                  {c.currentTargetC != null ? fmtC(c.currentTargetC, 1) : "aus"}
                </span>
              </p>
              <p className={cn("inline-flex items-center gap-1", c.heating ? "text-warning" : "")}>
                <Flame className="h-3 w-3" />
                {c.heating ? "heizt" : "Heizung aus"}
                {c.lastSwitchAt && <span className="opacity-70">· {fmtAgo(c.lastSwitchAt, nowMs)}</span>}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** "Alle an" / "Alle aus" fuer die Beleuchtung eines Raums. */
function AllLightsButton({
  lights,
  statuses,
  onAction,
}: {
  lights: RoomDevice[];
  statuses: Map<number, DeviceStatus>;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const switchable = lights.filter((d) => isLatchingSwitchDevice(d) && d.isActive);
  if (switchable.length < 2) return null;
  const anyOn = switchable.some((d) => statuses.get(d.id)?.output === true);
  async function run() {
    setBusy(true);
    for (const d of switchable) await onAction(d, anyOn ? "reset" : "open");
    setBusy(false);
  }
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {anyOn ? "Alle aus" : "Alle an"}
    </button>
  );
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

/** Personen heute: Verlauf nach Stunde, gerade jemand da, erkannte Personen. */
function ActivityWidget({ room, nowMs }: { room: RoomPanelData; nowMs: number }) {
  const a = room.activity;
  const max = a ? Math.max(1, ...a.hours) : 1;
  const currentHour = new Date(nowMs).getHours();
  return (
    <Widget
      icon={<Users className="h-3.5 w-3.5" />}
      title="Ereignisse heute"
      tone={a?.present ? "active" : "default"}
      action={
        a?.present ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            gerade jemand da
          </span>
        ) : a?.lastAt ? (
          <span className="text-[11px] text-muted-foreground">zuletzt {fmtAgo(a.lastAt, nowMs)}</span>
        ) : null
      }
    >
      {!a || a.total === 0 ? (
        <p className="px-0.5 text-[11px] text-muted-foreground">Heute noch keine Person erkannt.</p>
      ) : (
        <>
          <p className="px-0.5 text-[11px] text-muted-foreground">
            <span className="text-lg font-semibold tabular-nums text-foreground">{a.total}</span>{" "}
            Personen-Ereignisse
          </p>
          <div className="px-0.5">
            <div className="flex h-10 items-end gap-px" role="img" aria-label="Personen-Ereignisse je Stunde">
              {a.hours.map((n, h) => (
                <div
                  key={h}
                  title={`${String(h).padStart(2, "0")}–${String(h + 1).padStart(2, "0")} Uhr: ${n}`}
                  className={cn(
                    "flex-1 rounded-t-sm",
                    n === 0 ? "bg-muted" : h === currentHour ? "bg-primary" : "bg-primary/45",
                  )}
                  style={{ height: `${n === 0 ? 6 : Math.max(12, (n / max) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground/70">
              <span>0</span>
              <span>6</span>
              <span>12</span>
              <span>18</span>
              <span>24</span>
            </div>
          </div>
        </>
      )}
      {a && (a.people.length > 0 || a.unknown > 0) && (
        <div className="flex flex-wrap gap-1 px-0.5">
          {a.people.map((p) => (
            <span
              key={p.name}
              title={`${p.count}× gesehen, zuletzt ${clock(p.lastAt)}`}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
                p.listType === "BLACKLIST" ? "bg-destructive/12 text-destructive" : "bg-muted text-foreground/80",
              )}
            >
              {p.name}
              <span className="tabular-nums text-muted-foreground">{p.count}× · {clock(p.lastAt)}</span>
            </span>
          ))}
          {a.unknown > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {a.unknown}× unbekannte Person
            </span>
          )}
        </div>
      )}
    </Widget>
  );
}

/** Ob ein Raum irgendetwas zum Anzeigen hat. */
export function roomHasEquipment(room: RoomPanelData): boolean {
  return room.devices.length + room.zones.length + room.cameras.length + room.locks.length > 0 || !!room.climate;
}

/**
 * Ein Raum als Leitstand-Karte mit Widgets: Klima, Beleuchtung, Beschallung,
 * Ueberwachung und uebrige Geraete. Darunter die Regeln und Schliesspunkte.
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
}: {
  room: RoomPanelData;
  statuses: Map<number, DeviceStatus>;
  nowMs: number;
  timezone: string;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
  onZoneAction: (zone: RoomZone, action: ZoneAction) => Promise<string | null>;
  onEdit: () => void;
  onClimate: () => void;
}) {
  const location = [room.building, room.floor].filter(Boolean).join(" · ");
  const groups = groupRoomDevices(room);
  const lightsOn = groups.light.filter((d) => statuses.get(d.id)?.output === true).length;
  const sensorIds = new Set(
    groups.climate.filter((d) => d.category === "SENSOR" || d.id === room.climate?.sensorDeviceId).map((d) => d.id),
  );
  const climateDevices = groups.climate.filter((d) => !sensorIds.has(d.id));
  const sensors = groups.climate.filter((d) => sensorIds.has(d.id));
  const headTemp =
    roomReading(sensors, statuses, "temperature") ??
    (room.climate?.lastTempC != null ? fmtC(room.climate.lastTempC) : null);
  const showClimate = groups.climate.length > 0 || !!room.climate;
  const playing = room.zones.filter((z) => z.isPlaying).length;

  const row = (device: RoomDevice) => (
    <DeviceRow
      key={device.id}
      device={device}
      roomName={room.name}
      status={statuses.get(device.id)}
      nowMs={nowMs}
      readonly={readonly}
      onAction={onAction}
    />
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold text-foreground/90">
              {room.name}
              {room.number && (
                <span className="font-mono text-[11px] font-normal text-muted-foreground/70">{room.number}</span>
              )}
            </p>
            {(location || room.doorCount > 0) && (
              <p className="truncate text-[11px] text-muted-foreground/70">
                {[location, room.doorCount > 0 ? `${room.doorCount} ${room.doorCount === 1 ? "Tür" : "Türen"}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          {headTemp && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-foreground/80"
              title="Raumtemperatur"
            >
              <Thermometer className="h-3 w-3 text-muted-foreground" />
              {headTemp}
            </span>
          )}
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

        {room.schedule && <OperatingLine schedule={room.schedule} timezone={timezone} nowMs={nowMs} />}
      </CardHeader>

      <CardContent className="space-y-2.5">
        {showClimate && (
          <Widget
            icon={<Thermometer className="h-3.5 w-3.5" />}
            title="Klima"
            tone={room.climate?.lastError ? "warn" : room.climate?.heating ? "active" : "default"}
            action={
              !readonly && (
                <button
                  type="button"
                  onClick={onClimate}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                >
                  {room.climate ? "Einstellen" : "Temperatur halten …"}
                </button>
              )
            }
          >
            <ClimateSummary room={room} devices={sensors} statuses={statuses} nowMs={nowMs} />
            {room.climate?.lastError && (
              <p className="flex items-center gap-1 px-0.5 text-[11px] text-destructive">
                <TriangleAlert className="h-3 w-3 shrink-0" />
                {room.climate.lastError}
              </p>
            )}
            {climateDevices.map(row)}
          </Widget>
        )}

        {groups.light.length > 0 && (
          <Widget
            icon={<Lightbulb className="h-3.5 w-3.5" />}
            title={lightsOn ? `Beleuchtung · ${lightsOn} an` : "Beleuchtung"}
            tone={lightsOn ? "active" : "default"}
            action={!readonly && <AllLightsButton lights={groups.light} statuses={statuses} onAction={onAction} />}
          >
            {groups.light.map(row)}
          </Widget>
        )}

        {room.zones.length > 0 && (
          <Widget
            icon={<Volume2 className="h-3.5 w-3.5" />}
            title={playing ? `Beschallung · ${playing} spielt` : "Beschallung"}
            tone={playing ? "active" : "default"}
          >
            {room.zones.map((zone) => (
              <ZoneRow key={`zone-${zone.id}`} zone={zone} nowMs={nowMs} readonly={readonly} onAction={onZoneAction} />
            ))}
          </Widget>
        )}

        {(room.cameras.length > 0 || room.lastEvent) && (
          <Widget icon={<Cctv className="h-3.5 w-3.5" />} title="Überwachung">
            {room.lastEvent && (
              <p className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
                <Radio className="h-3 w-3 shrink-0 text-info" />
                {eventTypeLabel(room.lastEvent.type)} {fmtAgo(room.lastEvent.startedAt, nowMs)}
                <span className="truncate text-muted-foreground/70">· {room.lastEvent.cameraName}</span>
              </p>
            )}
            {room.cameras.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {room.cameras.map((camera) => (
                  <Link
                    key={camera.id}
                    href="/kameras"
                    className="overflow-hidden rounded-md border border-border bg-card hover:border-primary/40"
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
                      <span className="truncate text-[10px] text-muted-foreground">{camera.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                        {camera.enabled ? fmtAgo(camera.snapshotAt, nowMs) : "aus"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Widget>
        )}

        {(room.activity || room.cameras.length > 0) && <ActivityWidget room={room} nowMs={nowMs} />}

        {groups.other.length > 0 && (
          <Widget icon={<Cpu className="h-3.5 w-3.5" />} title="Geräte">
            {groups.other.map(row)}
          </Widget>
        )}

        {room.locks.length > 0 && (
          <Widget icon={<Lock className="h-3.5 w-3.5" />} title="Schließung">
            {room.locks.map((lock) => (
              <div key={lock.id} className="flex items-center gap-1.5 px-0.5 text-[11px]">
                <span className="min-w-0 break-words text-muted-foreground">{lock.label}</span>
                {lock.deviceName && (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-primary" title="Wird elektronisch geöffnet">
                    <Zap className="h-2.5 w-2.5" />
                    {lock.deviceName}
                  </span>
                )}
              </div>
            ))}
          </Widget>
        )}

        {room.rules.length > 0 && (
          <div className="space-y-0.5">
            {room.rules.map((rule) => (
              <Link
                key={rule.id}
                href="/regeln"
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] hover:bg-muted",
                  rule.isActive ? "" : "opacity-50",
                )}
                title={rule.isActive ? `Zuletzt ausgelöst: ${fmtAgo(rule.lastRunAt, nowMs)}` : "Regel ist pausiert"}
              >
                <Workflow className="h-3 w-3 shrink-0 text-violet-500" />
                <span className="truncate text-muted-foreground">{rule.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground/70">{triggerLabel(rule.trigger)}</span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
