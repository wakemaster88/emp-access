"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CalendarClock,
  Cpu,
  Gauge,
  Lightbulb,
  Loader2,
  Lock,
  Pencil,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Thermometer,
  TriangleAlert,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  Workflow,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DeviceRow } from "@/components/raeume/device-row";
import type { ZoneAction } from "@/components/raeume/zone-row";
import { eventTypeLabel, fmtAgo } from "@/components/raeume/shared";
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
import { fmtWhen, ScheduleEmpty, ScheduleWidget } from "@/components/raeume/schedule-widget";
import { operatingSpanState } from "@/lib/operating-hours";
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

const sensorValue = (devices: RoomDevice[], statuses: Map<number, DeviceStatus>, kind: string) =>
  roomReading(devices, statuses, kind);

/** "17,5 °C" → 17.5 */
function parseC(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Ein Raum als Karte im Stil einer Smart-Home-App. Oben steht der Zustand
 * (geoeffnet, Anwesenheit, Stoerungen) und eine Schnellsteuerung (Licht,
 * Musik, Klima, Maeher). Darunter Reiter, in denen jede Info genau einmal
 * vorkommt: Steuerung, Zeitplan (Betriebszeit + Regeln), Sicherheit
 * (Kameras, Personen, Schliessung) und Technik (Fuehler, Netzwerk).
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

  // ── Bereiche der Karte: jede Info steht genau einmal, in ihrem Reiter. ──
  const spec = room.schedule
    ? { name: room.schedule.name, seasons: room.schedule.seasons, exceptions: room.schedule.exceptions }
    : null;
  const now = new Date(nowMs);
  const openState = spec ? operatingSpanState(spec, now, timezone) : null;
  const sensorsOnly = sensors;
  const offline = room.devices.filter((d) => statuses.get(d.id)?.online === false).length;
  const activeAutomations = room.automations.filter((a) => a.isActive).length;
  const hasControl =
    showClimate || groups.light.length > 0 || groups.mower.length > 0 || room.zones.length > 0 || groups.other.length > 0;
  const hasSecurity = room.cameras.length > 0 || !!room.activity || hasMotionSensor || room.locks.length > 0;
  const hasTech = network.length > 0 || sensorsOnly.length > 0;
  const tabs: { key: TabKey; label: string; icon: ReactNode; badge?: string | null; live?: boolean }[] = [
    hasControl && {
      key: "control" as const,
      label: "Steuerung",
      icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
      badge: lightsOn + playing + mowersMowing > 0 ? String(lightsOn + playing + mowersMowing) : null,
      live: lightsOn + playing + mowersMowing > 0,
    },
    {
      key: "time" as const,
      label: "Zeitplan",
      icon: <CalendarClock className="h-3.5 w-3.5" />,
      badge: activeAutomations > 0 ? String(activeAutomations) : null,
    },
    hasSecurity && {
      key: "security" as const,
      label: "Sicherheit",
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      badge: room.cameras.length > 0 ? String(room.cameras.length) : null,
      live: present,
    },
    hasTech && {
      key: "tech" as const,
      label: "Technik",
      icon: <Wifi className="h-3.5 w-3.5" />,
      badge: network.length + sensorsOnly.length > 0 ? String(network.length + sensorsOnly.length) : null,
    },
  ].filter(Boolean) as { key: TabKey; label: string; icon: ReactNode; badge?: string | null; live?: boolean }[];
  const [tabChoice, setTab] = useState<TabKey | null>(null);
  const tab: TabKey = tabChoice && tabs.some((t) => t.key === tabChoice) ? tabChoice : tabs[0].key;

  // Schnellsteuerung: ein Antippen schaltet den ganzen Raum.
  const switchableLights = lightTiles.filter((d) => d.isActive && statuses.get(d.id)?.online !== false);
  const playableZones = room.zones.filter((z) => z.isActive && z.hasPlayer);

  return (
    <Card className="overflow-hidden rounded-3xl border-border/70 shadow-sm">
      <CardHeader className="relative space-y-3 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent pb-3">
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
              aria-label="Raum bearbeiten"
              className="shrink-0 rounded-full p-2 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-primary"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Zustand auf einen Blick; jede Pille fuehrt zu ihrem Reiter. */}
        <div className="flex flex-wrap gap-1.5">
          <StatusPill
            tone={openState?.inside || !spec ? "live" : "muted"}
            dot={!!openState?.inside}
            onClick={() => setTab("time")}
          >
            {!spec
              ? "Immer verfügbar"
              : openState?.inside
                ? `Geöffnet${openState.until ? ` bis ${fmtWhen(openState.until, now, timezone)}` : ""}`
                : openState?.until
                  ? `Geschlossen · öffnet ${fmtWhen(openState.until, now, timezone)}`
                  : "Geschlossen"}
          </StatusPill>
          {hasSecurity && (present || room.activity?.lastAt) && (
            <StatusPill tone={present ? "violet" : "muted"} dot={present} onClick={() => setTab("security")}>
              <Users className="h-3 w-3" />
              {present ? "jemand da" : `zuletzt ${fmtAgo(room.activity!.lastAt!, nowMs)}`}
            </StatusPill>
          )}
          {offline > 0 && (
            <StatusPill tone="danger" onClick={() => setTab(hasControl ? "control" : "tech")}>
              <TriangleAlert className="h-3 w-3" />
              {offline} offline
            </StatusPill>
          )}
        </div>

        {/* Schnellsteuerung */}
        {(switchableLights.length > 1 || playableZones.length > 0 || showClimate || groups.mower.length > 0) && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {switchableLights.length > 1 && (
              <LightQuick devices={switchableLights} total={groups.light.length} onCount={lightsOn} readonly={readonly} onAction={onAction} />
            )}
            {playableZones.length > 0 && (
              <MusicQuick zones={playableZones} readonly={readonly} onZoneAction={onZoneAction} />
            )}
            {showClimate && (
              <QuickTile
                icon={<Thermometer className="h-4 w-4" />}
                label={
                  tempC != null
                    ? `${tempC.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`
                    : "Klima"
                }
                sub={
                  room.climate?.lastError
                    ? "Fehler"
                    : !room.climate
                      ? "nicht geregelt"
                      : !room.climate.isActive
                        ? "pausiert"
                        : room.climate.heating
                          ? `heizt auf ${room.climate.currentTargetC?.toLocaleString("de-DE") ?? room.climate.targetC} °C`
                          : room.climate.fanOn
                            ? "lüftet"
                            : room.climate.currentTargetC != null
                              ? `Ziel ${room.climate.currentTargetC.toLocaleString("de-DE")} °C`
                              : "Absenkung"
                }
                active={!!room.climate?.heating || !!room.climate?.fanOn}
                tone={room.climate?.lastError ? "danger" : room.climate?.heating ? "heat" : "air"}
                disabled={readonly}
                onClick={onClimate}
                title={room.climate ? "Klima einstellen" : "Temperatur halten …"}
              />
            )}
            {groups.mower.length > 0 && (
              <QuickTile
                icon={<Sprout className="h-4 w-4" />}
                label={groups.mower.length === 1 ? "Mäher" : `${groups.mower.length} Mäher`}
                sub={mowersMowing > 0 ? "mäht" : "parkt"}
                active={mowersMowing > 0}
                tone="live"
                onClick={() => setTab("control")}
                title="Zum Mähroboter"
              />
            )}
          </div>
        )}

        {tabs.length > 1 && (
          <div role="tablist" className="flex gap-1 rounded-full bg-muted/70 p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-medium transition-all",
                  tab === t.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.icon}
                <span className="hidden truncate min-[380px]:inline">{t.label}</span>
                {t.badge && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[9px] font-semibold tabular-nums",
                      t.live ? "bg-emerald-500 text-white" : "bg-foreground/10 text-foreground/70",
                    )}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-5 pt-1" role="tabpanel">
        {tab === "control" && (
          <>
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
              <Section icon={<Lightbulb className="h-3.5 w-3.5" />} title="Beleuchtung">
                {tiles(lightTiles)}
                {rows(lightRows)}
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

            {groups.other.length > 0 && (
              <Section icon={<Cpu className="h-3.5 w-3.5" />} title="Geräte">
                {tiles(otherTiles)}
                {rows(otherRows)}
              </Section>
            )}
          </>
        )}

        {tab === "time" && (
          <>
            {room.schedule ? (
              <ScheduleWidget schedule={room.schedule} climate={room.climate} timezone={timezone} nowMs={nowMs} hideStatus />
            ) : (
              <ScheduleEmpty onEdit={readonly ? undefined : onEdit} />
            )}
            <Section
              icon={<Workflow className="h-3.5 w-3.5" />}
              title="Regeln & Abläufe"
              action={
                !readonly && (
                  <Link href="/regeln" className="text-[11px] font-medium text-primary hover:underline">
                    {room.automations.length > 0 ? "Bearbeiten" : "Regel anlegen"}
                  </Link>
                )
              }
            >
              {room.automations.length > 0 ? (
                <AutomationWidget items={room.automations} nowMs={nowMs} timezone={timezone} />
              ) : (
                <p className="rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Noch keine Regeln. Zum Beispiel „30 Min. vor Öffnung Licht an“.
                </p>
              )}
            </Section>
          </>
        )}

        {tab === "security" && (
          <>
            {room.cameras.length > 0 && (
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
            )}
            {(room.activity || room.cameras.length > 0 || hasMotionSensor) && (
              <Section icon={<Users className="h-3.5 w-3.5" />} title="Personen heute">
                <div className="rounded-2xl border border-border bg-gradient-to-b from-primary/[0.04] to-transparent p-3">
                  <ActivityChart activity={room.activity} nowMs={nowMs} timezone={timezone} />
                </div>
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
          </>
        )}

        {tab === "tech" && (
          <>
            {sensorsOnly.length > 0 && (
              <Section icon={<Gauge className="h-3.5 w-3.5" />} title="Fühler">
                <div className="space-y-1.5">{rows(sensorsOnly)}</div>
              </Section>
            )}
            {network.length > 0 && (
              <Section icon={<Wifi className="h-3.5 w-3.5" />} title="Netzwerk">
                <NetworkWidget items={network} nowMs={nowMs} />
              </Section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type TabKey = "control" | "time" | "security" | "tech";

type QuickTone = "light" | "music" | "heat" | "air" | "live" | "danger";

const QUICK_ON: Record<QuickTone, string> = {
  light: "border-amber-300/60 bg-gradient-to-br from-amber-100 to-yellow-50 dark:border-amber-400/30 dark:from-amber-500/20 dark:to-transparent",
  music: "border-violet-300/60 bg-gradient-to-br from-violet-100 to-fuchsia-50 dark:border-violet-400/30 dark:from-violet-500/20 dark:to-transparent",
  heat: "border-orange-300/60 bg-gradient-to-br from-orange-100 to-rose-50 dark:border-orange-400/30 dark:from-orange-500/20 dark:to-transparent",
  air: "border-sky-300/60 bg-gradient-to-br from-sky-100 to-cyan-50 dark:border-sky-400/30 dark:from-sky-500/20 dark:to-transparent",
  live: "border-emerald-300/60 bg-gradient-to-br from-emerald-100 to-teal-50 dark:border-emerald-400/30 dark:from-emerald-500/20 dark:to-transparent",
  danger: "border-destructive/40 bg-destructive/5",
};
const QUICK_ICON_ON: Record<QuickTone, string> = {
  light: "bg-amber-400 text-white shadow-sm shadow-amber-500/40",
  music: "bg-violet-500 text-white shadow-sm shadow-violet-500/40",
  heat: "bg-orange-500 text-white shadow-sm shadow-orange-500/40",
  air: "bg-sky-500 text-white shadow-sm shadow-sky-500/40",
  live: "bg-emerald-500 text-white shadow-sm shadow-emerald-500/40",
  danger: "bg-destructive text-white",
};

/** Grosse Schnellkachel: Symbol, Wert, Zustand. Antippen schaltet bzw. oeffnet. */
function QuickTile({
  icon,
  label,
  sub,
  active,
  tone,
  busy,
  disabled,
  onClick,
  title,
}: {
  icon: ReactNode;
  label: string;
  sub: string;
  active: boolean;
  tone: QuickTone;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-pressed={active}
      title={title}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-2xl border p-2 text-left transition-all duration-300 enabled:active:scale-[0.97]",
        active || tone === "danger" ? QUICK_ON[tone] : "border-border bg-card enabled:hover:bg-muted/40 dark:bg-muted/30",
        disabled && "cursor-default",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
          active || tone === "danger" ? QUICK_ICON_ON[tone] : "bg-muted text-muted-foreground",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight tabular-nums">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

function LightQuick({
  devices,
  total,
  onCount,
  readonly,
  onAction,
}: {
  devices: RoomDevice[];
  total: number;
  onCount: number;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), 10_000);
    return () => clearTimeout(t);
  }, [pending]);
  const anyOn = pending ?? onCount > 0;
  async function toggle() {
    const next = !anyOn;
    setBusy(true);
    setPending(next);
    setError("");
    const errors: string[] = [];
    for (const d of devices) {
      const msg = await onAction(d, next ? "open" : "reset");
      if (msg) errors.push(msg);
    }
    setBusy(false);
    if (errors.length) {
      setPending(null);
      setError(errors[0]);
    }
  }
  return (
    <QuickTile
      icon={<Lightbulb className="h-4 w-4" />}
      label="Licht"
      sub={error ? "Fehler" : pending !== null ? (pending ? "alle an" : "alle aus") : onCount > 0 ? `${onCount} von ${total} an` : "alle aus"}
      active={anyOn}
      tone={error ? "danger" : "light"}
      busy={busy}
      disabled={readonly}
      onClick={() => void toggle()}
      title={error || `Alle Lichter ${anyOn ? "aus" : "an"}`}
    />
  );
}

function MusicQuick({
  zones,
  readonly,
  onZoneAction,
}: {
  zones: RoomZone[];
  readonly: boolean;
  onZoneAction: (zone: RoomZone, action: ZoneAction) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const playing = zones.filter((z) => z.isPlaying);
  const on = playing.length > 0;
  async function toggle() {
    setBusy(true);
    setError("");
    const targets = on ? playing : zones;
    for (const z of targets) {
      const msg = await onZoneAction(z, on ? "STOP" : "PLAY");
      if (msg) setError(msg);
    }
    setBusy(false);
  }
  return (
    <QuickTile
      icon={on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      label="Musik"
      sub={error ? "Fehler" : on ? (playing[0].currentTitle ?? "läuft") : "aus"}
      active={on}
      tone={error ? "danger" : "music"}
      busy={busy}
      disabled={readonly}
      onClick={() => void toggle()}
      title={error || (on ? "Musik stoppen" : "Musik starten")}
    />
  );
}

function StatusPill({
  children,
  tone,
  dot,
  onClick,
}: {
  children: ReactNode;
  tone: "muted" | "live" | "violet" | "danger";
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums transition-opacity hover:opacity-80",
        tone === "live" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
        tone === "violet" && "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "muted" && "bg-muted text-foreground/80",
      )}
    >
      {dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {children}
    </button>
  );
}
