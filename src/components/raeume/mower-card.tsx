"use client";

/**
 * Maehroboter im Raum, aufgebaut wie das Betriebszeit-Widget: gross, was der
 * Maeher gerade tut, darunter wo und wie weit, dann Akku und naechste Mahd.
 * Daneben die Karte, zugeschnitten auf die Wiesen, mit Zonennummern und der
 * Live-Position; Antippen vergroessert sie.
 *
 * Unten nur die Knoepfe, die im Zustand Sinn ergeben, der naheliegende zuerst
 * und hervorgehoben. Beenden und Starten brauchen ein zweites Tippen. Nach
 * einem Befehl zeigt die Karte, dass er unterwegs ist, bis der Maeher
 * antwortet.
 *
 * Der Zustand kommt vom Hub (POST /api/hub/mower-sync) und wird hier alle
 * 30 s neu gelesen; Befehle gehen als Hub-Task (POST /api/devices/[id]/mower).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BatteryCharging, CalendarClock, ChevronDown, Home, Loader2, Maximize2, Pause, Play, Square, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  canStartTask,
  describeMower,
  mapBounds,
  mowerButtons,
  mowerTone,
  nextMowing,
  polygonCenter,
  projectOnMap,
  weekdaysLabel,
  zoneBadge,
  zoneLabel,
  type MowerAction,
  type MowerButton,
  type MowerMap,
  type MowerState,
  type MowerTaskView,
  type MowerTone,
} from "@/lib/mower";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtAgo } from "@/components/raeume/shared";
import type { RoomDevice } from "@/components/raeume/types";

export interface MowerLive {
  state: MowerState | null;
  lastUpdate: string | null;
}

/** Ohne Meldung seit dieser Zeit gilt der Stand als veraltet. */
const STALE_MS = 10 * 60_000;
const POLL_MS = 30_000;
/** So lange wartet die Karte nach einem Befehl auf eine Antwort. */
const PENDING_MS = 75_000;
/** So lange bleibt ein Knopf "scharf" fuer das zweite Tippen. */
const ARM_MS = 4_000;

/** Zustand aller Maeher, solange einer auf der Seite ist. */
export function useMowerStates(enabled: boolean): { live: Map<number, MowerLive>; refreshSoon: () => void } {
  const [live, setLive] = useState<Map<number, MowerLive>>(new Map());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mowers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { mowers?: ({ id: number } & MowerLive)[] };
      setLive(new Map((data.mowers ?? []).map((m) => [m.id, { state: m.state, lastUpdate: m.lastUpdate }])));
    } catch {
      // naechster Takt
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void load(), 1_000);
    const timer = setInterval(() => void load(), POLL_MS);
    const pending = timers.current;
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      pending.forEach(clearTimeout);
    };
  }, [enabled, load]);

  // Der Hub holt den Befehl in ~5 s ab, der Maeher meldet sich danach.
  const refreshSoon = useCallback(() => {
    timers.current.push(
      setTimeout(() => void load(), 6_000),
      setTimeout(() => void load(), 12_000),
      setTimeout(() => void load(), 25_000),
      setTimeout(() => void load(), 45_000),
    );
  }, [load]);

  return { live, refreshSoon };
}

const TONE: Record<MowerTone, { text: string; dot: string; ping?: boolean; card: string; marker: string }> = {
  mowing: {
    text: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    ping: true,
    card: "border-emerald-400/35 bg-gradient-to-b from-emerald-500/10 to-transparent",
    marker: "#10b981",
  },
  paused: {
    text: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
    card: "border-amber-400/35 bg-gradient-to-b from-amber-500/10 to-transparent",
    marker: "#f59e0b",
  },
  returning: {
    text: "text-sky-700 dark:text-sky-400",
    dot: "bg-sky-500",
    ping: true,
    card: "border-sky-400/35 bg-gradient-to-b from-sky-500/10 to-transparent",
    marker: "#0ea5e9",
  },
  charging: {
    text: "text-foreground",
    dot: "bg-emerald-500",
    card: "glass-tile",
    marker: "#64748b",
  },
  idle: {
    text: "text-foreground",
    dot: "bg-slate-400",
    card: "glass-tile",
    marker: "#64748b",
  },
  error: {
    text: "text-destructive",
    dot: "bg-destructive",
    ping: true,
    card: "border-destructive/40 bg-destructive/5",
    marker: "#ef4444",
  },
  offline: {
    text: "text-muted-foreground",
    dot: "bg-slate-300 dark:bg-slate-600",
    card: "border-dashed border-(--glass-border) bg-transparent",
    marker: "#94a3b8",
  },
};

function StatusDot({ tone }: { tone: MowerTone }) {
  const t = TONE[tone];
  return (
    <span className={cn("relative flex h-2.5 w-2.5 shrink-0 rounded-full", t.dot)}>
      {t.ping && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", t.dot)} />}
    </span>
  );
}

function BatteryLevel({ value, charging }: { value: number | null; charging: boolean }) {
  const v = value ?? 0;
  const fill = v < 15 ? "bg-red-500" : v < 30 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span className="flex items-center gap-1.5" title={charging ? "Akku, lädt" : "Akku"}>
      <span className="relative h-3 w-6 shrink-0 rounded-[3px] border border-foreground/35 p-px">
        <span className={cn("block h-full rounded-[2px] transition-all", fill)} style={{ width: `${Math.max(6, Math.min(100, v))}%` }} />
        <span className="absolute -right-[3px] top-1/2 h-1.5 w-[2px] -translate-y-1/2 rounded-r bg-foreground/35" />
      </span>
      <span className="font-semibold tabular-nums">{value != null ? `${Math.round(value)} %` : "–"}</span>
      {charging && <BatteryCharging className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
    </span>
  );
}

/**
 * Karte: Wiesen, Wege, Hindernisse, Station und Maeher. `px` ist die
 * ungefaehre Darstellungsgroesse, damit Marker und Schrift in der kleinen
 * und der grossen Ansicht gleich gross wirken.
 */
function MowerMapView({
  map,
  state,
  tone,
  label,
  px,
  className,
}: {
  map: MowerMap;
  state: MowerState | null;
  tone: MowerTone;
  label: string;
  px: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const pos = projectOnMap(map, state?.position ?? null);
  const box = mapBounds(map, [pos]);
  const centers = useMemo(() => map.areas.map((a) => (a.name ? polygonCenter(a.pts) : null)), [map]);
  const u = Math.max(box.w, box.h) / px;
  const moving = tone === "mowing" || tone === "returning";
  const job = tone === "mowing" || tone === "paused";
  const currentZone = state?.currentZone ?? null;
  const marker = TONE[tone].marker;
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className={className}
      role="img"
      aria-label={`Karte ${label}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={`lawn-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
        <linearGradient id={`lawn-hot-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d9f99d" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
        <pattern id={`stripes-${uid}`} width={u * 7} height={u * 7} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width={u * 3.5} height={u * 7} fill="white" opacity="0.12" />
        </pattern>
        <pattern id={`hatch-${uid}`} width={u * 4} height={u * 4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={u * 4} stroke="#ef4444" strokeWidth={u * 1.4} opacity="0.8" />
        </pattern>
      </defs>
      {map.areas.map((a, i) => {
        const hot = job && !!currentZone && a.name === currentZone;
        return (
          <g key={`a${i}`} opacity={tone === "offline" ? 0.45 : 1}>
            <polygon
              points={a.pts}
              fill={`url(#${hot ? "lawn-hot" : "lawn"}-${uid})`}
              stroke={hot ? "white" : "#15803d"}
              strokeWidth={u * (hot ? 1.6 : 1)}
              strokeLinejoin="round"
            >
              <title>{zoneLabel(a.name) || "Fläche"}</title>
            </polygon>
            <polygon points={a.pts} fill={`url(#stripes-${uid})`} className="pointer-events-none" />
          </g>
        );
      })}
      {map.paths.map((p, i) => (
        <polyline
          key={`p${i}`}
          points={p}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={u * 1.6}
          strokeDasharray={`${u * 3} ${u * 2}`}
          strokeLinecap="round"
          opacity="0.9"
        />
      ))}
      {map.obstacles.map((p, i) => (
        <polygon key={`o${i}`} points={p} fill={`url(#hatch-${uid})`} stroke="#dc2626" strokeWidth={u} />
      ))}
      {map.areas.map((a, i) => {
        const c = centers[i];
        const text = zoneBadge(a.name);
        if (!c || !text) return null;
        const hot = job && !!currentZone && a.name === currentZone;
        const rw = Math.max(u * 8, u * (text.length * 5.6 + 4));
        return (
          <g key={`l${i}`} transform={`translate(${c[0]} ${c[1]})`} className="pointer-events-none select-none">
            <rect x={-rw / 2} y={-u * 7} width={rw} height={u * 14} rx={u * 7} fill={hot ? "white" : "#052e16"} opacity={hot ? 1 : 0.72} />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={u * 9.5}
              fontWeight={700}
              fill={hot ? "#166534" : "white"}
            >
              {text}
            </text>
          </g>
        );
      })}
      {map.dock && (
        <g transform={`translate(${map.dock[0]} ${map.dock[1]})`}>
          <rect x={-u * 7} y={-u * 7} width={u * 14} height={u * 14} rx={u * 3.5} fill="#0f172a" stroke="white" strokeWidth={u * 1.4} />
          <path
            d={`M${-u * 3.8} ${u * 0.6} L0 ${-u * 3.6} L${u * 3.8} ${u * 0.6} M${-u * 2.4} 0 V${u * 3.6} H${u * 2.4} V0`}
            fill="none"
            stroke="white"
            strokeWidth={u * 1.3}
            strokeLinejoin="round"
          />
          <title>Ladestation</title>
        </g>
      )}
      {pos && tone !== "offline" && (
        <g transform={`translate(${pos[0]} ${pos[1]})`}>
          {moving && (
            <circle r={u * 7} fill={marker} opacity="0.45">
              <animate attributeName="r" values={`${u * 7};${u * 20}`} dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.55;0" dur="1.8s" repeatCount="indefinite" />
            </circle>
          )}
          <circle r={u * 9} fill="black" opacity="0.25" />
          <circle r={u * 7} fill={marker} stroke="white" strokeWidth={u * 2.4} />
          <title>{label}</title>
        </g>
      )}
    </svg>
  );
}

/** Knopf mit zweitem Tippen zur Bestaetigung, wo noetig. */
function ActionButton({
  label,
  confirm,
  armed,
  icon,
  kind,
  busy,
  disabled,
  hint,
  onClick,
  className,
}: {
  label: string;
  confirm?: string;
  armed: boolean;
  icon: React.ReactNode;
  kind: MowerButton["kind"];
  busy: boolean;
  disabled: boolean;
  hint?: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition-all active:scale-[0.97] disabled:opacity-50 [&_svg]:shrink-0",
        armed
          ? kind === "danger"
            ? "bg-destructive text-white shadow-sm ring-2 ring-destructive/30"
            : "bg-amber-500 text-white shadow-sm ring-2 ring-amber-500/30"
          : kind === "primary"
            ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
            : kind === "danger"
              ? "border border-border bg-background/60 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              : "border border-border bg-background/60 text-foreground hover:bg-muted",
        className,
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {armed && confirm ? confirm : label}
    </button>
  );
}

const ICONS: Record<MowerAction, React.ReactNode> = {
  start_task: <Play className="h-3.5 w-3.5" />,
  pause: <Pause className="h-3.5 w-3.5" />,
  resume: <Play className="h-3.5 w-3.5" />,
  stop: <Square className="h-3.5 w-3.5" />,
  dock: <Home className="h-3.5 w-3.5" />,
};

function taskLine(t: MowerTaskView): string {
  return [
    t.weekdays.length ? weekdaysLabel(t.weekdays) : null,
    t.startTime || null,
    t.bladeHeightMm ? `${t.bladeHeightMm} mm` : null,
    t.zones.length ? t.zones.map(zoneLabel).join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function MowerCard({
  device,
  map,
  initial,
  live,
  nowMs,
  timezone,
  readonly,
  onAction,
}: {
  device: RoomDevice;
  map: MowerMap | null;
  initial: MowerState | null;
  live: MowerLive | undefined;
  nowMs: number;
  timezone: string;
  readonly: boolean;
  onAction: (device: RoomDevice, action: MowerAction, planId?: string) => Promise<string | null>;
}) {
  const state = live?.state ?? initial;
  const lastUpdate = live?.lastUpdate ?? device.lastUpdate;
  const stale = !lastUpdate || nowMs - new Date(lastUpdate).getTime() > STALE_MS;
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, setPending] = useState<{ text: string; status: string; at: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [bigMap, setBigMap] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Antwort des Maehers: der Zustand hat sich geaendert.
  const answered = !!pending && (state?.status ?? "") !== pending.status;
  const waiting = pending && !answered ? pending : null;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(
      () => {
        setPending(null);
        if (!answered) setMessage({ text: "Noch keine Rückmeldung vom Mäher. Stand bitte gleich nochmal prüfen.", error: false });
      },
      answered ? 0 : Math.max(0, pending.at + PENDING_MS - Date.now()),
    );
    return () => clearTimeout(t);
  }, [pending, answered]);
  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
  }, []);

  if (!state) {
    return (
      <div className="rounded-tile border border-dashed border-(--glass-border) p-3 text-xs text-muted-foreground">
        {device.name}: noch keine Meldung vom Hub.
      </div>
    );
  }

  const tone: MowerTone = stale ? "offline" : mowerTone(state);
  const summary = stale
    ? { title: "Keine Meldung", detail: lastUpdate ? `letzte Meldung ${fmtAgo(lastUpdate, nowMs)}` : "der Hub hat noch nichts gemeldet", progress: false }
    : describeMower(state);
  const next = nextMowing(state.tasks, nowMs, timezone);
  const canControl = !readonly && !stale && state.online;
  const buttons = canControl ? mowerButtons(state) : [];
  const startable = canControl && canStartTask(state);
  const runningTask = state.tasks.find((t) => t.running) ?? null;
  const showMap = !!map && map.areas.length > 0;
  const box = showMap ? mapBounds(map, [projectOnMap(map, state.position)]) : null;
  const tall = !!box && box.w / box.h < 0.85;
  const locked = busy !== null || waiting !== null;

  function arm(key: string): boolean {
    if (armed === key) {
      setArmed(null);
      if (armTimer.current) clearTimeout(armTimer.current);
      return true;
    }
    setArmed(key);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(null), ARM_MS);
    return false;
  }

  async function run(action: MowerAction, pendingText: string, opts: { confirm?: boolean; planId?: string } = {}) {
    const key = opts.planId ? `${action}:${opts.planId}` : action;
    if (opts.confirm && !arm(key)) return;
    setArmed(null);
    setBusy(key);
    setMessage(null);
    const err = await onAction(device, action, opts.planId);
    setBusy(null);
    if (err) setMessage({ text: err, error: true });
    else setPending({ text: pendingText, status: state!.status, at: Date.now() });
  }

  function startNow() {
    if (state!.tasks.length === 1) {
      void run("start_task", "Startet gleich …", { confirm: true, planId: state!.tasks[0].id });
    } else {
      setPlanOpen(true);
    }
  }

  const progress = summary.progress && state.progress != null ? Math.max(0, Math.min(100, state.progress)) : null;

  const mapTile = showMap && (
    <button
      type="button"
      onClick={() => setBigMap(true)}
      aria-label={`Karte von ${device.name} vergrößern`}
      className={cn(
        "group relative shrink-0 overflow-hidden rounded-xl bg-emerald-950/[0.06] ring-1 ring-inset ring-black/5 transition hover:ring-primary/40 dark:bg-black/30 dark:ring-white/5",
        tall ? "aspect-[3/5] w-[38%] min-w-[104px] max-w-[170px] self-start" : "h-40 w-full",
      )}
    >
      <MowerMapView map={map!} state={stale ? null : state} tone={tone} label={device.name} px={tall ? 190 : 170} className="absolute inset-0 h-full w-full p-1" />
      <span className="absolute bottom-1 right-1 rounded-md bg-black/45 p-1 text-white opacity-70 transition group-hover:opacity-100">
        <Maximize2 className="h-3 w-3" />
      </span>
    </button>
  );

  return (
    <div className={cn("overflow-hidden rounded-tile border p-3.5 transition-colors", TONE[tone].card)}>
      <div className={cn("flex gap-3", !tall && "flex-col")}>
        {tall && mapTile}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-xs font-semibold text-foreground/80">{device.name}</p>
            {lastUpdate && !stale && (
              <span className="shrink-0 text-[10px] text-muted-foreground" title="Stand vom Hub">
                {fmtAgo(lastUpdate, nowMs)}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <StatusDot tone={tone} />
            <span className={cn("text-lg font-semibold leading-tight tracking-tight", TONE[tone].text)}>{summary.title}</span>
          </div>
          {waiting ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-primary">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              {waiting.text}
            </p>
          ) : (
            summary.detail && (
              <p className={cn("mt-0.5 text-xs", tone === "error" ? "text-destructive" : "text-muted-foreground")}>{summary.detail}</p>
            )
          )}
          {progress != null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-label={`${Math.round(progress)} % geschafft`}>
              <div
                className={cn("h-full rounded-full transition-all", tone === "mowing" ? "bg-emerald-500" : "bg-amber-500")}
                style={{ width: `${Math.max(progress, 1.5)}%` }}
              />
            </div>
          )}

          <div className={cn("space-y-1.5 text-xs", tall ? "mt-auto pt-3" : "mt-3 flex flex-wrap gap-x-4 gap-y-1.5 space-y-0")}>
            <BatteryLevel value={state.battery} charging={state.charging} />
            {state.tasks.length > 0 ? (
              <button
                type="button"
                onClick={() => setPlanOpen((v) => !v)}
                aria-expanded={planOpen}
                className="flex max-w-full items-center gap-1.5 text-left text-foreground/90 hover:text-primary"
              >
                <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {runningTask ? (
                    <>
                      <span className="font-semibold">{runningTask.name}</span> läuft
                    </>
                  ) : next ? (
                    <>
                      mäht <span className="font-semibold">{next.label}</span>
                    </>
                  ) : (
                    "kein Termin geplant"
                  )}
                </span>
                <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", planOpen && "rotate-180")} />
              </button>
            ) : (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                kein Zeitplan
              </p>
            )}
          </div>
        </div>
        {!tall && mapTile}
      </div>

      {state.errors.length > 1 && !stale && (
        <div className="mt-2 space-y-0.5">
          {state.errors.slice(1).map((e) => (
            <p key={e.code} className="flex items-start gap-1 text-[11px] text-destructive">
              <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
              {e.text || `Fehler ${e.code}`}
            </p>
          ))}
        </div>
      )}

      {(buttons.length > 0 || (startable && state.tasks.length > 0)) && (
        <div className="mt-3 flex gap-1.5">
          {startable && state.tasks.length > 0 && (
            <ActionButton
              label="Jetzt mähen"
              confirm={state.tasks.length === 1 ? "Starten?" : undefined}
              armed={state.tasks.length === 1 && armed === `start_task:${state.tasks[0].id}`}
              icon={ICONS.start_task}
              kind="primary"
              busy={state.tasks.length === 1 && busy === `start_task:${state.tasks[0].id}`}
              disabled={locked}
              hint={state.tasks.length === 1 ? `Aufgabe „${state.tasks[0].name}“ jetzt starten` : "Aufgabe wählen"}
              onClick={startNow}
              className="min-w-0 flex-1"
            />
          )}
          {buttons.map((b) => (
            <ActionButton
              key={b.action + b.label}
              label={b.label}
              confirm={b.confirm}
              armed={armed === b.action}
              icon={ICONS[b.action]}
              kind={startable && state.tasks.length > 0 && b.kind === "primary" ? "secondary" : b.kind}
              busy={busy === b.action}
              disabled={locked}
              hint={b.hint}
              onClick={() => void run(b.action, b.pending, { confirm: !!b.confirm })}
              className={b.kind === "primary" && !(startable && state.tasks.length > 0) ? "min-w-0 flex-1" : "shrink-0"}
            />
          ))}
        </div>
      )}
      {canControl && state.tasks.length === 0 && !state.active && (
        <p className="mt-2 text-[11px] text-muted-foreground">Zum Mähen in der Mammotion-App eine Aufgabe anlegen, sie erscheint dann hier.</p>
      )}

      {planOpen && state.tasks.length > 0 && (
        <div className="glass-tile mt-3 divide-y divide-border/50 overflow-hidden">
          {state.tasks.map((t) => (
            <div key={t.id} className={cn("flex items-center gap-2 px-2.5 py-2 text-xs", !t.enabled && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {t.name}
                  {t.running && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">läuft</span>}
                  {!t.enabled && <span className="ml-1.5 text-muted-foreground">aus</span>}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{taskLine(t) || "ohne Termin"}</p>
              </div>
              {startable && (
                <ActionButton
                  label="Starten"
                  confirm="Sicher?"
                  armed={armed === `start_task:${t.id}`}
                  icon={ICONS.start_task}
                  kind="secondary"
                  busy={busy === `start_task:${t.id}`}
                  disabled={locked}
                  hint={`Aufgabe „${t.name}“ jetzt starten`}
                  onClick={() => void run("start_task", "Startet gleich …", { confirm: true, planId: t.id })}
                  className="h-8 px-2.5"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {message && (
        <p className={cn("mt-2 text-[11px]", message.error ? "text-destructive" : "text-muted-foreground")}>{message.text}</p>
      )}

      {showMap && (
        <Dialog open={bigMap} onOpenChange={setBigMap}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{device.name}</DialogTitle>
              <DialogDescription>
                {[summary.title, summary.detail].filter(Boolean).join(" · ")}
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-hidden rounded-xl bg-emerald-950/[0.06] p-2 dark:bg-black/30">
              <MowerMapView map={map!} state={stale ? null : state} tone={tone} label={device.name} px={400} className="mx-auto h-[min(62vh,560px)] w-full" />
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {map!.areas
                .filter((a) => a.name)
                .map((a, i) => {
                  const hot = !stale && !!state.currentZone && a.name === state.currentZone;
                  return (
                    <span
                      key={`${i}-${a.name}`}
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                        hot ? "bg-emerald-500 text-white" : "bg-muted text-foreground/80",
                      )}
                    >
                      {zoneLabel(a.name)}
                      {hot && " · hier"}
                    </span>
                  );
                })}
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground/80">
                <span className="h-2 w-2 rounded-full ring-2 ring-white" style={{ background: TONE[tone].marker }} />
                Mäher
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {[state.model, state.firmware ? `Firmware ${state.firmware}` : null, lastUpdate ? `Stand ${fmtAgo(lastUpdate, nowMs)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
