"use client";

/**
 * Grafische Bausteine der Raumkarte: Temperatur-Ring, Geraete-Kacheln im Stil
 * einer Smart-Home-App, Beschallungskarte mit Equalizer, Kamerabild und
 * Ereignis-Kurve. Logik (Gruppierung, Schalten) bleibt in room-panel.tsx und
 * device-row.tsx.
 */

import { useEffect, useId, useState } from "react";
import {
  Activity,
  Blinds,
  Cctv,
  ChevronDown,
  CircleDot,
  DoorOpen,
  Fan,
  Flame,
  KeyRound,
  Lightbulb,
  Loader2,
  Pause,
  Play,
  Power,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isLatchingSwitchDevice } from "@/lib/device-controls";
import type { RoomActivity } from "@/lib/room-activity";
import type { DeviceStatus } from "@/components/raeume/status";
import type { RoomCamera, RoomClimateView, RoomDevice, RoomZone } from "@/components/raeume/types";
import { fmtAgo, shortDeviceName } from "@/components/raeume/shared";
import type { ZoneAction } from "@/components/raeume/zone-row";

// ─── Temperatur-Ring ─────────────────────────────────────────────────────────

const GAUGE_MIN = 10;
const GAUGE_MAX = 30;
const SWEEP = 260; // Grad

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  // Gerundet, damit Server und Browser denselben Pfad erzeugen (Hydration).
  const round = (v: number) => Math.round(v * 100) / 100;
  return { x: round(cx + r * Math.cos(rad)), y: round(cy + r * Math.sin(rad)) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

function angleFor(c: number) {
  const t = Math.min(1, Math.max(0, (c - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));
  return -SWEEP / 2 + t * SWEEP;
}

const fmt1 = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Ring mit Ist-Temperatur (Punkt + Fuellung) und Soll (Strich). */
export function TempGauge({
  tempC,
  targetC,
  heating,
  size = 132,
}: {
  tempC: number | null;
  targetC: number | null;
  heating: boolean;
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  const cx = 60;
  const cy = 60;
  const r = 48;
  const start = -SWEEP / 2;
  const end = SWEEP / 2;
  const cur = tempC != null ? angleFor(tempC) : null;
  const tgt = targetC != null ? angleFor(targetC) : null;
  const dot = cur != null ? polar(cx, cy, r, cur) : null;
  const t1 = tgt != null ? polar(cx, cy, r - 9, tgt) : null;
  const t2 = tgt != null ? polar(cx, cy, r + 9, tgt) : null;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`Temperatur ${tempC ?? "unbekannt"} °C`}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="55%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#fb923c" />
        </linearGradient>
        <filter id={`f${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <path d={arc(cx, cy, r, start, end)} fill="none" strokeWidth="9" strokeLinecap="round" className="stroke-muted" />
      {cur != null && (
        <>
          {heating && (
            <path d={arc(cx, cy, r, start, cur)} fill="none" stroke={`url(#g${id})`} strokeWidth="9" strokeLinecap="round" filter={`url(#f${id})`} opacity="0.7" />
          )}
          <path d={arc(cx, cy, r, start, Math.max(start + 0.5, cur))} fill="none" stroke={`url(#g${id})`} strokeWidth="9" strokeLinecap="round" />
        </>
      )}
      {t1 && t2 && <line x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} strokeWidth="2.5" strokeLinecap="round" className="stroke-foreground/70" />}
      {dot && <circle cx={dot.x} cy={dot.y} r="6.5" className="fill-background" stroke="currentColor" strokeWidth="2.5" />}
      <text x={cx} y={cy + 2} textAnchor="middle" className="fill-foreground" style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em" }}>
        {tempC != null ? fmt1(tempC) : "–"}
        <tspan style={{ fontSize: 11, fontWeight: 500 }} dx="1" dy="-8">°C</tspan>
      </text>
      <text x={cx} y={cy + 20} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9.5 }}>
        {targetC != null ? `Soll ${fmt1(targetC)}°` : "ohne Soll"}
      </text>
      {heating && (
        <g transform={`translate(${cx - 6} ${cy + 27})`} className="text-orange-500">
          <path d="M6 0c1.5 2.4 4 4 4 7.2A4 4 0 0 1 2 7.2C2 5.6 3 4.6 3.6 3.6 4 5 5 5.4 5.6 5.2 5 3.4 5.4 1.6 6 0Z" fill="currentColor" />
        </g>
      )}
    </svg>
  );
}

/** Kopfteil des Klima-Widgets: Ring links, Kennzahlen rechts. */
export function ClimateHero({
  tempC,
  humidity,
  climate,
  nowMs,
}: {
  tempC: number | null;
  humidity: string | null;
  climate: RoomClimateView | null;
  nowMs: number;
}) {
  const heating = !!climate?.isActive && climate.heating === true;
  const target = climate?.isActive ? climate.currentTargetC : null;
  const stat = (label: string, value: string, tone?: string) => (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
  return (
    <div className="flex items-center gap-3">
      <TempGauge tempC={tempC} targetC={target} heating={heating} />
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2">
        {humidity && stat("Luftfeuchte", humidity)}
        {climate?.isActive && climate.fanDeviceIds.length > 0 &&
          stat(
            "Lüftung",
            climate.fanOn ? "lüftet" : `aus · an ab ${climate.fanOnHumidity.toLocaleString("de-DE")} %`,
            climate.fanOn ? "text-sky-500" : undefined,
          )}
        {climate
          ? climate.isActive && climate.heaterDeviceIds.length === 0
            ? null
            : climate.isActive
            ? stat(
                "Heizung",
                heating ? "heizt" : target == null ? "aus · geschlossen" : "aus",
                heating ? "text-orange-500" : undefined,
              )
            : stat("Regelung", "pausiert")
          : stat("Regelung", "nicht eingerichtet", "text-muted-foreground font-normal")}
        {climate?.lastSwitchAt && stat("Geschaltet", fmtAgo(climate.lastSwitchAt, nowMs))}
      </div>
    </div>
  );
}

// ─── Geraete-Kachel ──────────────────────────────────────────────────────────

type Tone = "light" | "heat" | "air" | "default";

function toneFor(device: RoomDevice): Tone {
  if (device.category === "BELEUCHTUNG" || device.type === "HUE_LIGHT") return "light";
  if (/heiz|ofen|radiator/i.test(device.name)) return "heat";
  if (/l(ü|ue)ft|ventil|klima|fan/i.test(device.name)) return "air";
  return "default";
}

const TONE_ON: Record<Tone, string> = {
  light:
    "border-amber-300/60 bg-gradient-to-br from-amber-100 via-amber-50 to-white shadow-[0_8px_24px_-8px_rgba(245,158,11,0.55)] dark:border-amber-400/30 dark:from-amber-500/25 dark:via-amber-500/10 dark:to-transparent",
  heat:
    "border-orange-300/60 bg-gradient-to-br from-orange-100 via-rose-50 to-white shadow-[0_8px_24px_-8px_rgba(249,115,22,0.55)] dark:border-orange-400/30 dark:from-orange-500/25 dark:via-rose-500/10 dark:to-transparent",
  air:
    "border-sky-300/60 bg-gradient-to-br from-sky-100 via-cyan-50 to-white shadow-[0_8px_24px_-8px_rgba(14,165,233,0.5)] dark:border-sky-400/30 dark:from-sky-500/25 dark:via-cyan-500/10 dark:to-transparent",
  default:
    "border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent shadow-[0_8px_24px_-10px_var(--primary)]",
};
const TONE_ICON_ON: Record<Tone, string> = {
  light: "bg-amber-400 text-white shadow-[0_0_16px_rgba(251,191,36,0.8)]",
  heat: "bg-orange-500 text-white shadow-[0_0_16px_rgba(249,115,22,0.7)]",
  air: "bg-sky-500 text-white shadow-[0_0_16px_rgba(14,165,233,0.6)]",
  default: "bg-primary-fill text-primary-foreground",
};

function TileIcon({ device, tone, className }: { device: RoomDevice; tone: Tone; className?: string }) {
  if (tone === "light") return <Lightbulb className={className} />;
  if (tone === "heat") return <Flame className={className} />;
  if (tone === "air") return <Fan className={className} />;
  if (device.type === "NUKI_SMARTLOCK" || device.type === "LOQED_SMARTLOCK") return <KeyRound className={className} />;
  if (device.category === "TUER") return <DoorOpen className={className} />;
  if (device.category === "MARKISE" || device.category === "ROLLTOR") return <Blinds className={className} />;
  if (device.category === "TASTER") return <CircleDot className={className} />;
  if (device.category === "SENSOR") return <Activity className={className} />;
  return <Power className={className} />;
}

/**
 * Kachel fuer Schalter und Licht: antippen schaltet. Leuchtet im Farbton der
 * Geraeteart, solange es an ist. Andere Geraete (Tueren, Antriebe) bleiben
 * Zeilen mit eigenen Knoepfen.
 */
export function DeviceTile({
  device,
  roomName,
  status,
  readonly,
  onAction,
}: {
  device: RoomDevice;
  roomName: string;
  status: DeviceStatus | undefined;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), 10_000);
    return () => clearTimeout(t);
  }, [pending]);

  const reported = status ? status.output === true : device.type === "HUE_LIGHT" && device.task === 1;
  const on = pending ?? reported;
  const offline = !!status && !status.online;
  const tone = toneFor(device);
  const label = shortDeviceName(device.name, roomName);
  const canToggle = !readonly && isLatchingSwitchDevice(device) && device.isActive && !offline;

  async function toggle() {
    if (!canToggle || busy) return;
    const next = !on;
    setPending(next);
    setBusy(true);
    setError("");
    const message = await onAction(device, next ? "open" : "reset");
    setBusy(false);
    if (message) {
      setPending(null);
      setError(message);
    }
  }

  const sub = offline
    ? "offline"
    : on
      ? status?.power != null && status.power > 0
        ? `an · ${Math.round(status.power)} W`
        : "an"
      : "aus";

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!canToggle}
      title={error || (label !== device.name ? device.name : undefined)}
      aria-pressed={on}
      className={cn(
        "group relative flex min-h-[52px] items-center gap-2.5 rounded-tile border py-2 pl-2 pr-3 text-left transition-all duration-300",
        "disabled:cursor-default enabled:hover:-translate-y-0.5 enabled:active:scale-[0.97]",
        on ? TONE_ON[tone] : "glass-tile enabled:hover:bg-foreground/5",
        offline && "opacity-60",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300",
          on ? TONE_ICON_ON[tone] : "bg-muted text-muted-foreground",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TileIcon device={device} tone={tone} className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">{label}</span>
        <span className={cn("block truncate text-[11px]", error ? "text-destructive" : on ? "text-foreground/70" : "text-muted-foreground")}>
          {error ? "Fehler" : busy ? "schaltet …" : sub}
        </span>
      </span>
    </button>
  );
}

/**
 * Taster: ein Antippen löst einen Impuls aus, der im Gerät abläuft. Der Ring
 * zeigt die Restzeit, danach steht die Kachel wieder bereit.
 */
export function PulseTile({
  device,
  roomName,
  status,
  readonly,
  onAction,
}: {
  device: RoomDevice;
  roomName: string;
  status: DeviceStatus | undefined;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
}) {
  const seconds = Math.max(1, device.pulseSeconds ?? 3);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState("");
  const running = remaining != null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setRemaining((r) => (r == null || r - 0.25 <= 0 ? null : r - 0.25)), 250);
    return () => clearInterval(t);
  }, [running]);

  const offline = !!status && !status.online;
  const label = shortDeviceName(device.name, roomName);
  const canPress = !readonly && device.isActive && !offline && !busy && !running;
  const frac = remaining == null ? 0 : 1 - remaining / seconds;
  const R = 13;
  const C = 2 * Math.PI * R;

  async function press() {
    if (!canPress) return;
    setBusy(true);
    setError("");
    const message = await onAction(device, "open");
    setBusy(false);
    if (message) setError(message);
    else setRemaining(seconds);
  }

  return (
    <button
      type="button"
      onClick={() => void press()}
      disabled={!canPress}
      title={error || (label !== device.name ? device.name : undefined)}
      className={cn(
        "group relative flex min-h-[52px] items-center gap-2.5 rounded-tile border py-2 pl-2 pr-3 text-left transition-all duration-300",
        "disabled:cursor-default enabled:hover:-translate-y-0.5 enabled:active:scale-[0.97]",
        running ? TONE_ON.default : "glass-tile enabled:hover:bg-foreground/5",
        offline && "opacity-60",
      )}
    >
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
        <svg viewBox="0 0 32 32" className="absolute inset-0 h-8 w-8 -rotate-90" aria-hidden>
          <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2.5" className={running ? "stroke-primary/25" : "stroke-foreground/10"} />
          {running && (
            <circle
              cx="16"
              cy="16"
              r={R}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="stroke-primary transition-[stroke-dashoffset] duration-300 ease-linear"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
            />
          )}
        </svg>
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", running ? "bg-primary-fill text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleDot className="h-3.5 w-3.5" />}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">{label}</span>
        <span className={cn("block truncate text-[11px] tabular-nums", error ? "text-destructive" : running ? "text-foreground/70" : "text-muted-foreground")}>
          {error
            ? "Fehler"
            : offline
              ? "offline"
              : running
                ? `Impuls läuft … ${Math.ceil(remaining)} s`
                : busy
                  ? "schaltet …"
                  : `Impuls ${seconds} s · antippen`}
        </span>
      </span>
    </button>
  );
}

// ─── Beschallung ─────────────────────────────────────────────────────────────

export function ZoneCard({
  zone,
  nowMs,
  readonly,
  onAction,
}: {
  zone: RoomZone;
  nowMs: number;
  readonly: boolean;
  onAction: (zone: RoomZone, action: ZoneAction) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const playing = zone.isPlaying;
  const canControl = !readonly && zone.hasPlayer && zone.isActive;

  async function run() {
    setBusy(true);
    setError("");
    const message = await onAction(zone, playing ? "STOP" : "PLAY");
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-tile border p-3 transition-colors",
        playing
          ? "border-violet-400/40 bg-gradient-to-br from-violet-600 via-fuchsia-600 to-indigo-600 text-white shadow-[0_10px_30px_-10px_rgba(139,92,246,0.7)]"
          : "glass-tile",
      )}
    >
      {playing && <div className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/15 blur-2xl" />}
      <div className="relative flex items-center gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            playing ? "bg-white/20" : "bg-muted text-muted-foreground",
          )}
        >
          {playing ? (
            <span className="room-eq flex h-4 items-end gap-[3px]" aria-hidden>
              <span className="h-full w-[3px] rounded-full bg-white" />
              <span className="h-full w-[3px] rounded-full bg-white" />
              <span className="h-full w-[3px] rounded-full bg-white" />
              <span className="h-full w-[3px] rounded-full bg-white" />
            </span>
          ) : (
            <Volume2 className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-tight">{zone.name}</p>
          <p className={cn("truncate text-[11px]", playing ? "text-white/80" : "text-muted-foreground")}>
            {!zone.hasPlayer
              ? "ohne Abspieler"
              : playing
                ? zone.currentTitle || "spielt"
                : zone.lastStateAt
                  ? `still · ${fmtAgo(zone.lastStateAt, nowMs)}`
                  : "still"}
          </p>
        </div>
        {canControl && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            aria-label={playing ? "Wiedergabe stoppen" : "Wiedergabe starten"}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90 disabled:opacity-60",
              playing ? "bg-white text-violet-700" : "bg-primary-fill text-primary-foreground shadow-md",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
        )}
      </div>
      {error && <p className="relative mt-1.5 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// ─── Kamera ──────────────────────────────────────────────────────────────────

export function CameraTile({
  camera,
  nowMs,
  eventLabel,
  wide,
}: {
  camera: RoomCamera;
  nowMs: number;
  eventLabel: string | null;
  wide: boolean;
}) {
  const fresh = camera.snapshotAt && nowMs - new Date(camera.snapshotAt).getTime() < 5 * 60_000;
  return (
    <a
      href="/kameras"
      className={cn(
        "group relative block overflow-hidden rounded-tile border border-(--glass-border) bg-slate-900",
        wide ? "col-span-2 aspect-[16/8]" : "aspect-video",
      )}
    >
      {camera.snapshotAt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/cameras/${camera.id}/snapshot?t=${encodeURIComponent(camera.snapshotAt)}`}
          alt={`Schnappschuss ${camera.name}`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
          <Cctv className="h-8 w-8 text-slate-500" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="absolute left-2 top-2 flex items-center gap-1">
        {camera.enabled ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide backdrop-blur",
              fresh ? "bg-red-500/90 text-white" : "bg-black/50 text-white/80",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", fresh ? "animate-pulse bg-white" : "bg-white/60")} />
            {fresh ? "Live" : fmtAgo(camera.snapshotAt, nowMs)}
          </span>
        ) : (
          <span className="rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white/80 backdrop-blur">aus</span>
        )}
      </div>
      <div className="absolute inset-x-2 bottom-1.5 flex items-end justify-between gap-2 text-white">
        <span className="truncate text-xs font-semibold drop-shadow">{camera.name}</span>
        {eventLabel && <span className="shrink-0 text-[10px] text-white/80">{eventLabel}</span>}
      </div>
    </a>
  );
}

// ─── Ereignisse ──────────────────────────────────────────────────────────────

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const mx = (p0.x + p1.x) / 2;
    d += ` C ${mx} ${p0.y}, ${mx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

export function ActivityChart({
  activity,
  nowMs,
  timezone,
}: {
  activity: RoomActivity | null;
  nowMs: number;
  timezone: string;
}) {
  const id = useId().replace(/:/g, "");
  const a = activity;
  const W = 280;
  const H = 64;
  // Stunde in der Zeitzone des Mandanten, damit Server und Browser gleich rechnen.
  const hour = Number(
    new Intl.DateTimeFormat("de-DE", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(nowMs),
  ) % 24;
  const max = a ? Math.max(1, ...a.hours) : 1;
  const pts = (a?.hours ?? Array(24).fill(0)).map((n, h) => ({
    x: (h / 23) * W,
    y: H - 4 - (n / max) * (H - 12),
  }));
  const line = smoothPath(pts);
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const nowPt = pts[hour];
  const peak = a ? a.hours.indexOf(Math.max(...a.hours)) : -1;

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-semibold leading-none tabular-nums tracking-tight">{a?.total ?? 0}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {!a || a.motion === 0
              ? "Personen-Ereignisse heute"
              : a.motion === a.total
                ? "Bewegungen heute (Bewegungsmelder)"
                : `Ereignisse heute · ${a.motion} vom Bewegungsmelder`}
          </p>
        </div>
        {a && a.total > 0 && peak >= 0 && (
          <p className="text-right text-[11px] text-muted-foreground">
            meist los
            <br />
            <span className="font-medium text-foreground">
              {String(peak).padStart(2, "0")}–{String(peak + 1).padStart(2, "0")} Uhr
            </span>
          </p>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 12}`} className="h-auto w-full" role="img" aria-label="Personen-Ereignisse je Stunde">
        <defs>
          <linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[6, 12, 18].map((h) => (
          <line key={h} x1={(h / 23) * W} x2={(h / 23) * W} y1={0} y2={H} className="stroke-border" strokeDasharray="2 3" />
        ))}
        <path d={area} fill={`url(#a${id})`} />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
        {nowPt && (
          <>
            <line x1={nowPt.x} x2={nowPt.x} y1={nowPt.y} y2={H} stroke="var(--primary)" strokeOpacity="0.4" />
            <circle cx={nowPt.x} cy={nowPt.y} r="4" fill="var(--primary)" className="drop-shadow" />
            <circle cx={nowPt.x} cy={nowPt.y} r="8" fill="var(--primary)" opacity="0.2" />
          </>
        )}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={(h / 23) * W} y={H + 10} textAnchor={h === 0 ? "start" : "middle"} className="fill-muted-foreground" style={{ fontSize: 8 }}>
            {h} Uhr
          </text>
        ))}
      </svg>
      {a && (a.people.length > 0 || a.unknown > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {a.people.slice(0, 6).map((p) => (
            <span
              key={p.name}
              title={`${p.name}: ${p.count}× gesehen, zuletzt ${new Date(p.lastAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: timezone })}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px]",
                p.listType === "BLACKLIST" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-(--glass-border) bg-(--glass-tile)",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white",
                  p.listType === "BLACKLIST" ? "bg-destructive" : "bg-gradient-to-br from-indigo-500 to-violet-500",
                )}
              >
                {initials(p.name)}
              </span>
              {p.name}
              <span className="tabular-nums text-muted-foreground">{p.count}×</span>
            </span>
          ))}
          {a.unknown > 0 && <span className="text-[11px] text-muted-foreground">+ {a.unknown}× unbekannt</span>}
        </div>
      )}
    </div>
  );
}

// ─── Gruppe ──────────────────────────────────────────────────────────────────

/**
 * Mehrere gleichartige Geraete als eine Kachel: "Belüftung · 1 von 2 an".
 * Antippen schaltet alle (eins an → alle aus, sonst alle an); der Pfeil klappt
 * die einzelnen Geraete auf. Mit nur einem Geraet die normale Kachel.
 */
export function GroupTile({
  title,
  devices,
  roomName,
  statuses,
  readonly,
  onAction,
  wide = false,
}: {
  title: string;
  devices: RoomDevice[];
  roomName: string;
  statuses: Map<number, DeviceStatus>;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), 10_000);
    return () => clearTimeout(t);
  }, [pending]);

  if (devices.length === 1) {
    return (
      <div className={cn("grid", wide && "col-span-2")}>
        <DeviceTile
          device={devices[0]}
          roomName={roomName}
          status={statuses.get(devices[0].id)}
          readonly={readonly}
          onAction={onAction}
        />
      </div>
    );
  }

  const isOn = (d: RoomDevice) => {
    const s = statuses.get(d.id);
    return s ? s.output === true : d.type === "HUE_LIGHT" && d.task === 1;
  };
  const switchable = devices.filter(
    (d) => isLatchingSwitchDevice(d) && d.isActive && statuses.get(d.id)?.online !== false,
  );
  const onCount = pending === null ? devices.filter(isOn).length : pending ? switchable.length : 0;
  const anyOn = onCount > 0;
  const tone = toneFor(devices[0]);
  const canToggle = !readonly && switchable.length > 0;
  const power = devices.reduce((sum, d) => sum + (isOn(d) ? (statuses.get(d.id)?.power ?? 0) : 0), 0);

  async function toggle() {
    if (!canToggle || busy) return;
    const next = !anyOn;
    setPending(next);
    setBusy(true);
    setError("");
    const errors: string[] = [];
    for (const d of switchable) {
      const message = await onAction(d, next ? "open" : "reset");
      if (message) errors.push(`${shortDeviceName(d.name, roomName)}: ${message}`);
    }
    setBusy(false);
    if (errors.length) {
      setPending(null);
      setError(errors.join(" · "));
    }
  }

  return (
    <div className={cn("space-y-2", (wide || open) && "col-span-2")}>
      <div
        className={cn(
          "relative flex min-h-[92px] flex-col justify-between rounded-tile border p-3 transition-all duration-300",
          anyOn ? TONE_ON[tone] : "glass-tile",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={!canToggle}
            aria-pressed={anyOn}
            title={error || `${title}: alle ${anyOn ? "aus" : "an"}`}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300 enabled:active:scale-90",
              anyOn ? TONE_ICON_ON[tone] : "bg-muted text-muted-foreground enabled:hover:bg-muted/70",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TileIcon device={devices[0]} tone={tone} className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/60 hover:text-foreground"
            aria-expanded={open}
          >
            {devices.length}
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
          </button>
        </div>
        <button type="button" onClick={() => void toggle()} disabled={!canToggle} className="mt-2 block text-left">
          <span className="block text-[13px] font-semibold leading-tight text-foreground">{title}</span>
          <span className={cn("block text-[11px]", error ? "text-destructive" : anyOn ? "text-foreground/70" : "text-muted-foreground")}>
            {error
              ? "Fehler"
              : busy
                ? "schaltet …"
                : anyOn
                ? `${onCount} von ${devices.length} an${power > 0 ? ` · ${Math.round(power)} W` : ""}`
                : `alle ${devices.length} aus`}
          </span>
        </button>
        {/* Fortschritt: wie viele an */}
        <div className="mt-2 flex gap-1">
          {devices.map((d, i) => (
            <span
              key={d.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                (pending === null ? isOn(d) : i < onCount) ? TONE_BAR[tone] : "bg-foreground/10",
              )}
            />
          ))}
        </div>
      </div>
      {open && (
        <div className="glass-tile grid grid-cols-2 gap-2 p-1.5">
          {devices.map((d) => (
            <DeviceTile key={d.id} device={d} roomName={roomName} status={statuses.get(d.id)} readonly={readonly} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

const TONE_BAR: Record<Tone, string> = {
  light: "bg-amber-400",
  heat: "bg-orange-500",
  air: "bg-sky-500",
  default: "bg-primary",
};
