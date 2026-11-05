"use client";

/**
 * Lagebild: alle Räume auf einen Blick.
 *
 * Oben Kennzahlen, die zugleich Filter sind. Darunter eine Kachel je Raum
 * mit Zustand, Bildzeile und zwei Mini-Schaltern (Licht, Musik). Unten die
 * beiden Spuren "Demnächst" und "Braucht Aufmerksamkeit". Jede Zahl kommt
 * aus room-summary.ts und wird hier nur gezeigt.
 */

import { useEffect, useState } from "react";
import {
  Cctv,
  Clock,
  Droplets,
  Flame,
  Lightbulb,
  Loader2,
  Sprout,
  Thermometer,
  TriangleAlert,
  Users,
  Volume2,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { RoomIcon } from "@/components/raeume/room-icons";
import { nextParts } from "@/components/raeume/automation-widget";
import type { RoomAlert, RoomSummary, UpcomingItem } from "@/components/raeume/room-summary";
import type { RoomDevice, RoomZone } from "@/components/raeume/types";
import type { ZoneAction } from "@/components/raeume/zone-row";
import { cn } from "@/lib/utils";

export type OverviewFilter = "all" | "open" | "present" | "lights" | "music" | "alerts";

interface Kpi {
  key: OverviewFilter;
  label: string;
  value: number;
  of: string;
  total: number;
  Icon: LucideIcon;
  tone: string;
  bar: string;
}

export function buildKpis(summaries: RoomSummary[]): Kpi[] {
  const n = summaries.length;
  const lampsOn = summaries.reduce((s, r) => s + r.lightsOn, 0);
  const lampsTotal = summaries.reduce((s, r) => s + r.lightsTotal, 0);
  const zones = summaries.reduce((s, r) => s + r.playableZones.length, 0);
  const music = summaries.reduce((s, r) => s + r.room.zones.filter((z) => z.isPlaying).length, 0);
  return [
    { key: "all", label: "Räume", value: n, of: "mit Ausstattung", total: n, Icon: Users, tone: "text-foreground", bar: "bg-foreground/40" },
    { key: "open", label: "geöffnet", value: summaries.filter((r) => r.open === true).length, of: `von ${n}`, total: n, Icon: Clock, tone: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
    { key: "present", label: "jemand da", value: summaries.filter((r) => r.present).length, of: "Räume", total: n, Icon: Users, tone: "text-violet-600 dark:text-violet-400", bar: "bg-violet-500" },
    { key: "lights", label: "Lichter an", value: lampsOn, of: `von ${lampsTotal}`, total: lampsTotal, Icon: Lightbulb, tone: "text-amber-600 dark:text-amber-400", bar: "bg-amber-400" },
    { key: "music", label: "Musik läuft", value: music, of: `von ${zones} Zonen`, total: zones, Icon: Volume2, tone: "text-violet-600 dark:text-violet-400", bar: "bg-violet-400" },
    { key: "alerts", label: "Störungen", value: summaries.filter((r) => r.alerts.length > 0).length, of: "Räume", total: n, Icon: TriangleAlert, tone: "text-destructive", bar: "bg-destructive" },
  ];
}

export function matchesFilter(r: RoomSummary, filter: OverviewFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return r.open === true;
    case "present":
      return r.present;
    case "lights":
      return r.lightsOn > 0;
    case "music":
      return r.musicOn;
    case "alerts":
      return r.alerts.length > 0;
  }
}

function KpiTile({ kpi, active, onClick }: { kpi: Kpi; active: boolean; onClick: () => void }) {
  const pct = kpi.total > 0 ? Math.round((kpi.value / kpi.total) * 100) : 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "glass-tile flex min-w-0 flex-col gap-1.5 px-3 py-2.5 text-left transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:active:scale-[0.98]",
        active && "ring-2 ring-primary/60",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full bg-foreground/5", kpi.tone)}>
          <kpi.Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className={cn("block text-lg font-bold leading-none tabular-nums", kpi.tone)}>{kpi.value}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{kpi.of}</span>
        </span>
      </span>
      <span className="text-[11px] font-medium text-foreground/80">{kpi.label}</span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
        <span className={cn("block h-full rounded-full transition-all", kpi.bar)} style={{ width: `${pct}%` }} />
      </span>
    </button>
  );
}

function MiniToggle({
  on,
  tone,
  Icon,
  label,
  disabled,
  onToggle,
  title,
}: {
  on: boolean;
  tone: "light" | "music";
  Icon: LucideIcon;
  label: string;
  disabled: boolean;
  onToggle: () => Promise<string | null>;
  title: string;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), 10_000);
    return () => clearTimeout(t);
  }, [pending]);
  const shown = pending ?? on;
  async function run(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    setPending(!shown);
    const msg = await onToggle();
    setBusy(false);
    if (msg) {
      setPending(null);
      setError(msg);
    }
  }
  return (
    <button
      type="button"
      aria-pressed={shown}
      disabled={disabled || busy}
      onClick={(e) => void run(e)}
      title={error || title}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tabular-nums transition-all enabled:active:scale-95",
        error
          ? "border-destructive/40 text-destructive"
          : shown
            ? tone === "light"
              ? "border-amber-300/60 bg-amber-400/20 text-amber-700 dark:border-amber-400/30 dark:text-amber-300"
              : "border-violet-300/60 bg-violet-500/20 text-violet-700 dark:border-violet-400/30 dark:text-violet-300"
            : "border-border/70 bg-foreground/[0.03] text-muted-foreground enabled:hover:text-foreground",
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {error ? "Fehler" : label}
    </button>
  );
}

const TINT: Record<string, string> = {
  alert: "border-destructive/40 bg-gradient-to-b from-destructive/10 to-transparent",
  present: "border-violet-400/40 bg-gradient-to-b from-violet-500/12 to-transparent",
  open: "border-emerald-400/35 bg-gradient-to-b from-emerald-500/10 to-transparent",
  closed: "",
};

function RoomTile({
  s,
  nowMs,
  readonly,
  onOpen,
  onAction,
  onZoneAction,
}: {
  s: RoomSummary;
  nowMs: number;
  readonly: boolean;
  onOpen: () => void;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
  onZoneAction: (zone: RoomZone, action: ZoneAction) => Promise<string | null>;
}) {
  const state = s.alerts.length > 0 ? "alert" : s.present ? "present" : s.open === true ? "open" : "closed";
  const lastEvent = s.room.lastEvent;
  const chips: { Icon: LucideIcon; text: string; tone?: string }[] = [];
  if (s.camerasTotal > 0) {
    chips.push({
      Icon: Cctv,
      text: `${s.camerasTotal} ${s.camerasTotal === 1 ? "Kamera" : "Kameras"}${lastEvent ? ` · ${ago(lastEvent.startedAt, nowMs)}` : ""}`,
      tone: s.camerasStale > 0 ? "text-destructive" : undefined,
    });
  }
  if (s.climateLabel) {
    chips.push({
      Icon: s.climateTone === "heat" ? Flame : s.climateTone === "air" ? Wind : Thermometer,
      text: s.climateLabel,
      tone:
        s.climateTone === "heat"
          ? "text-orange-600 dark:text-orange-400"
          : s.climateTone === "air"
            ? "text-sky-600 dark:text-sky-400"
            : s.climateTone === "danger"
              ? "text-destructive"
              : undefined,
    });
  }
  if (s.mowersTotal > 0) {
    chips.push({
      Icon: Sprout,
      text: `${s.mowersTotal === 1 ? "Mäher" : `${s.mowersTotal} Mäher`} · ${s.mowersMowing > 0 ? "mäht" : "parkt"}`,
      tone: s.mowersMowing > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined,
    });
  }
  if (s.irrigationLabel) {
    chips.push({
      Icon: Droplets,
      text: `Bewässerung · ${s.irrigationLabel}`,
      tone: s.irrigationRunning ? "text-sky-600 dark:text-sky-400" : undefined,
    });
  }
  const lightsSwitchable = !readonly && s.switchableLights.length > 0;
  const musicSwitchable = !readonly && s.playableZones.length > 0;

  async function toggleLights() {
    const next = !(s.lightsOn > 0);
    const errors: string[] = [];
    for (const d of s.switchableLights) {
      const msg = await onAction(d, next ? "open" : "reset");
      if (msg) errors.push(msg);
    }
    return errors[0] ?? null;
  }
  async function toggleMusic() {
    const playing = s.room.zones.filter((z) => z.isPlaying);
    const targets = playing.length > 0 ? playing : s.playableZones;
    let error: string | null = null;
    for (const z of targets) {
      const msg = await onZoneAction(z, playing.length > 0 ? "STOP" : "PLAY");
      if (msg) error = msg;
    }
    return error;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "glass-tile group flex min-w-0 cursor-pointer flex-col gap-2.5 p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5",
        TINT[state],
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_6px_16px_-6px_var(--primary)]",
            state === "alert" ? "bg-gradient-to-br from-destructive to-rose-400" : "bg-gradient-to-br from-primary to-violet-500",
          )}
        >
          <RoomIcon room={s.room} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold tracking-tight text-foreground">
            {s.room.name}
            {s.present && (
              <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                jemand da
              </span>
            )}
          </p>
          <p
            className={cn(
              "flex items-center gap-1.5 truncate text-[11px]",
              s.open === true ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {s.open === true && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            {s.openLabel}
          </p>
        </div>
      </div>

      {(chips.length > 0 || s.alerts.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {s.alerts.slice(0, 1).map((a) => (
            <span key={a.text} className="flex items-center gap-1 font-medium text-destructive">
              <TriangleAlert className="h-3 w-3" />
              {a.text}
            </span>
          ))}
          {chips.map((c) => (
            <span key={c.text} className={cn("flex items-center gap-1", c.tone)}>
              <c.Icon className="h-3 w-3" />
              {c.text}
            </span>
          ))}
        </div>
      )}

      {(s.lightsTotal > 0 || s.playableZones.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {s.lightsTotal > 0 && (
            <MiniToggle
              on={s.lightsOn > 0}
              tone="light"
              Icon={Lightbulb}
              label={`${s.lightsOn} / ${s.lightsTotal}`}
              disabled={!lightsSwitchable}
              onToggle={toggleLights}
              title={s.lightsOn > 0 ? "Alle Lichter aus" : "Alle Lichter an"}
            />
          )}
          {s.playableZones.length > 0 && (
            <MiniToggle
              on={s.musicOn}
              tone="music"
              Icon={Volume2}
              label={s.musicOn ? (s.musicTitle ?? "läuft") : "Musik aus"}
              disabled={!musicSwitchable}
              onToggle={toggleMusic}
              title={s.musicOn ? "Musik stoppen" : "Musik starten"}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ago(iso: string, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.round(min / 60);
  return h < 24 ? `vor ${h} Std` : `vor ${Math.round(h / 24)} Tagen`;
}

function Lane({ title, Icon, children }: { title: string; Icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="glass-card min-w-0 p-4">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-label">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Overview({
  summaries,
  upcoming,
  filter,
  onFilter,
  nowMs,
  timezone,
  readonly,
  onOpenRoom,
  onAction,
  onZoneAction,
}: {
  summaries: RoomSummary[];
  upcoming: UpcomingItem[];
  filter: OverviewFilter;
  onFilter: (f: OverviewFilter) => void;
  nowMs: number;
  timezone: string;
  readonly: boolean;
  onOpenRoom: (roomId: number, tab?: RoomAlert["tab"]) => void;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
  onZoneAction: (zone: RoomZone, action: ZoneAction) => Promise<string | null>;
}) {
  const kpis = buildKpis(summaries);
  const visible = summaries.filter((r) => matchesFilter(r, filter));
  const alerts = summaries.flatMap((r) => r.alerts);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {kpis.map((k) => (
          <KpiTile key={k.key} kpi={k} active={filter === k.key} onClick={() => onFilter(filter === k.key ? "all" : k.key)} />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Kein Raum passt zum Filter.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((s) => (
            <RoomTile
              key={s.room.id}
              s={s}
              nowMs={nowMs}
              readonly={readonly}
              onOpen={() => onOpenRoom(s.room.id)}
              onAction={onAction}
              onZoneAction={onZoneAction}
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Lane title="Demnächst" Icon={Clock}>
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">Heute steht nichts mehr an.</p>
          ) : (
            <ul className="space-y-1">
              {upcoming.map((u) => {
                const next = nextParts(u.nextAt, nowMs, timezone);
                const soon = Date.parse(u.nextAt) - nowMs < 3 * 3_600_000;
                return (
                  <li key={u.key}>
                    <button
                      type="button"
                      onClick={() => onOpenRoom(u.roomId, "time")}
                      className="flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
                    >
                      <span
                        className={cn(
                          "w-14 shrink-0 rounded-xl py-1 text-center text-[12px] font-bold tabular-nums",
                          soon ? "bg-primary text-primary-foreground" : "bg-foreground/5 text-foreground",
                        )}
                      >
                        {next.time}
                        <span className="block text-[9px] font-medium uppercase opacity-70">{next.day}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{u.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {u.roomName}
                          {u.action ? ` · ${u.action}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Lane>
        <Lane title="Braucht Aufmerksamkeit" Icon={TriangleAlert}>
          {alerts.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Alles ruhig. Keine Störungen, alle Geräte antworten.
            </p>
          ) : (
            <ul className="space-y-1">
              {alerts.map((a, i) => (
                <li key={`${a.roomId}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onOpenRoom(a.roomId, a.tab)}
                    className="flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{a.text}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{a.roomName}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Lane>
      </div>
    </div>
  );
}
