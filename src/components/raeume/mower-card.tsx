"use client";

/**
 * Maehroboter im Raum: Karte mit Zonen und Live-Position, Akku, Fortschritt,
 * naechste Mahd und die Befehle, die der Hub an den Maeher weitergibt.
 *
 * Der Zustand kommt vom Hub (POST /api/hub/mower-sync) und wird hier alle
 * 30 s neu gelesen; Befehle gehen als Hub-Task (POST /api/devices/[id]/mower).
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BatteryCharging, CalendarClock, Home, Loader2, Pause, Play, Square, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  mowerTone,
  nextMowing,
  projectOnMap,
  weekdaysLabel,
  type MowerAction,
  type MowerMap,
  type MowerState,
  type MowerTone,
} from "@/lib/mower";
import { fmtAgo } from "@/components/raeume/shared";
import type { RoomDevice } from "@/components/raeume/types";

export interface MowerLive {
  state: MowerState | null;
  lastUpdate: string | null;
}

/** Ohne Meldung seit dieser Zeit gilt der Stand als veraltet. */
const STALE_MS = 10 * 60_000;
const POLL_MS = 30_000;

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
    timers.current.push(setTimeout(() => void load(), 8_000), setTimeout(() => void load(), 20_000));
  }, [load]);

  return { live, refreshSoon };
}

const TONE: Record<MowerTone, { pill: string; dot: string; label?: string }> = {
  mowing: { pill: "bg-white/20 text-white", dot: "bg-white animate-pulse" },
  paused: { pill: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-500" },
  returning: { pill: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", dot: "bg-sky-500 animate-pulse" },
  charging: { pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", dot: "bg-emerald-500" },
  idle: { pill: "bg-muted text-foreground/80", dot: "bg-slate-400" },
  error: { pill: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  offline: { pill: "bg-muted text-muted-foreground", dot: "bg-slate-300", label: "offline" },
};

/** Maehroboter von oben: Gehaeuse, zwei Raeder, Maehwerk. */
function MowerGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="5" y="4" width="14" height="16" rx="5" />
      <path d="M3 8v3M21 8v3M3 14v3M21 14v3" />
      <circle cx="12" cy="13" r="3" />
      <path d="M9.5 7.5h5" />
    </svg>
  );
}

function BatteryBar({ value, charging, inverted }: { value: number | null; charging: boolean; inverted: boolean }) {
  const v = value ?? 0;
  const tone = v < 15 ? "bg-red-500" : v < 30 ? "bg-amber-500" : inverted ? "bg-white" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("relative h-3.5 w-8 rounded-[4px] border p-[2px]", inverted ? "border-white/70" : "border-foreground/30")}>
        <div className={cn("h-full rounded-[2px] transition-all", tone)} style={{ width: `${Math.max(4, Math.min(100, v))}%` }} />
        <span className={cn("absolute -right-[3px] top-1/2 h-1.5 w-[2px] -translate-y-1/2 rounded-r", inverted ? "bg-white/70" : "bg-foreground/30")} />
      </div>
      <span className="text-xs font-semibold tabular-nums">{value != null ? `${Math.round(value)} %` : "–"}</span>
      {charging && <BatteryCharging className="h-3.5 w-3.5" />}
    </div>
  );
}

function centroid(pts: string): [number, number] | null {
  const xy = pts.split(" ").map((p) => p.split(",").map(Number));
  if (xy.length < 3) return null;
  let x = 0;
  let y = 0;
  for (const [a, b] of xy) {
    x += a;
    y += b;
  }
  return [x / xy.length, y / xy.length];
}

function MowerMapView({
  map,
  state,
  tone,
  label,
}: {
  map: MowerMap;
  state: MowerState | null;
  tone: MowerTone;
  label: string;
}) {
  const uid = useId().replace(/:/g, "");
  const pos = projectOnMap(map, state?.position ?? null);
  const active = tone === "mowing" || tone === "returning";
  const r = Math.max(map.w, map.h) / 60;
  const fontSize = Math.max(map.w, map.h) / 32;
  const currentZone = state?.currentZone ?? null;
  return (
    <svg viewBox={`0 0 ${map.w} ${map.h}`} className="h-auto max-h-56 w-full" role="img" aria-label={`Karte ${label}`}>
      <defs>
        <linearGradient id={`lawn-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
        <linearGradient id={`lawn-hot-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#bef264" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
        <pattern id={`stripes-${uid}`} width={r * 2.4} height={r * 2.4} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width={r * 1.2} height={r * 2.4} fill="white" opacity="0.13" />
        </pattern>
        <pattern id={`hatch-${uid}`} width={r} height={r} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={r} stroke="#ef4444" strokeWidth={r / 3} opacity="0.8" />
        </pattern>
      </defs>
      {map.areas.map((a, i) => {
        const hot = !!currentZone && a.name === currentZone && active;
        return (
          <g key={`a${i}`}>
            <polygon
              points={a.pts}
              fill={`url(#${hot ? "lawn-hot" : "lawn"}-${uid})`}
              stroke="#15803d"
              strokeWidth={r / 3}
              strokeLinejoin="round"
              opacity={tone === "offline" ? 0.5 : 0.95}
            >
              <title>{a.name}</title>
            </polygon>
            <polygon points={a.pts} fill={`url(#stripes-${uid})`} />
          </g>
        );
      })}
      {map.paths.map((p, i) => (
        <polyline key={`p${i}`} points={p} fill="none" stroke="#fbbf24" strokeWidth={r / 2.2} strokeDasharray={`${r} ${r / 1.5}`} strokeLinecap="round" opacity="0.85" />
      ))}
      {map.obstacles.map((p, i) => (
        <polygon key={`o${i}`} points={p} fill={`url(#hatch-${uid})`} stroke="#dc2626" strokeWidth={r / 3} />
      ))}
      {map.areas.map((a, i) => {
        const c = a.name ? centroid(a.pts) : null;
        return c ? (
          <text
            key={`l${i}`}
            x={c[0]}
            y={c[1]}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={fontSize}
            fontWeight={600}
            fill="white"
            stroke="#14532d"
            strokeWidth={fontSize / 5}
            paintOrder="stroke"
            className="pointer-events-none select-none"
          >
            {a.name}
          </text>
        ) : null;
      })}
      {map.dock && (
        <g transform={`translate(${map.dock[0]} ${map.dock[1]})`}>
          <rect x={-r * 1.3} y={-r * 1.3} width={r * 2.6} height={r * 2.6} rx={r / 2} fill="#0f172a" stroke="white" strokeWidth={r / 4} />
          <path d={`M${-r * 0.7} ${r * 0.1} L0 ${-r * 0.7} L${r * 0.7} ${r * 0.1} M${-r * 0.45} ${0} V${r * 0.7} H${r * 0.45} V${0}`} fill="none" stroke="white" strokeWidth={r / 4} strokeLinejoin="round" />
          <title>Ladestation</title>
        </g>
      )}
      {pos && (
        <g transform={`translate(${pos[0]} ${pos[1]})`}>
          {active && (
            <circle r={r} fill="#0ea5e9" opacity="0.45">
              <animate attributeName="r" values={`${r};${r * 3.2}`} dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;0" dur="1.8s" repeatCount="indefinite" />
            </circle>
          )}
          <circle r={r * 1.15} fill="#0284c7" stroke="white" strokeWidth={r / 2.5} />
          <title>{label}</title>
        </g>
      )}
    </svg>
  );
}

function ActionButton({
  onClick,
  busy,
  disabled,
  icon,
  children,
  primary,
  inverted,
}: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  primary?: boolean;
  inverted: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50",
        inverted
          ? primary
            ? "bg-white text-emerald-700 shadow"
            : "bg-white/15 text-white hover:bg-white/25"
          : primary
            ? "bg-primary text-primary-foreground shadow-sm"
            : "bg-muted text-foreground hover:bg-muted/70",
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

const CONFIRM: Partial<Record<MowerAction, string>> = {
  stop: "Laufenden Mähauftrag beenden? Der Mäher bleibt stehen, wo er ist.",
  dock: "Mäher zur Ladestation schicken?",
  start_task: "Diese Aufgabe jetzt starten?",
};

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
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  if (!state) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">
        {device.name}: noch keine Meldung vom Hub.
      </div>
    );
  }

  const tone: MowerTone = stale ? "offline" : mowerTone(state);
  const inverted = tone === "mowing";
  const style = TONE[tone];
  const next = nextMowing(state.tasks, nowMs, timezone);
  const statusText = stale ? "keine Meldung" : style.label ?? (state.statusLabel || state.status);
  const canControl = !readonly && !stale && state.online;
  const paused = state.status === "MODE_PAUSE" || state.status === "MODE_CHARGING_PAUSE";
  const working = state.status === "MODE_WORKING";

  async function run(action: MowerAction, planId?: string) {
    const ask = CONFIRM[action];
    if (ask && !window.confirm(ask)) return;
    setBusy(planId ? `${action}:${planId}` : action);
    setMessage(null);
    const err = await onAction(device, action, planId);
    setBusy(null);
    setMessage(err ? { text: err, error: true } : { text: "Befehl an den Hub gesendet", error: false });
    if (!err) setTimeout(() => setMessage(null), 12_000);
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-3 transition-colors",
        inverted
          ? "border-emerald-400/40 bg-gradient-to-br from-emerald-500 via-green-600 to-teal-700 text-white shadow-[0_10px_30px_-12px_rgba(16,185,129,0.8)]"
          : tone === "error"
            ? "border-destructive/40 bg-destructive/5"
            : "border-border bg-gradient-to-br from-emerald-50/80 via-card to-card dark:from-emerald-500/10 dark:via-muted/20 dark:to-muted/20",
      )}
    >
      {inverted && <div className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-white/15 blur-2xl" />}

      <div className="relative flex items-center gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            inverted ? "bg-white/20" : "bg-emerald-600 text-white shadow-[0_6px_16px_-8px_rgba(5,150,105,0.9)]",
          )}
        >
          <MowerGlyph className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-tight">{device.name}</p>
          <p className={cn("truncate text-[11px]", inverted ? "text-white/80" : "text-muted-foreground")}>
            {[state.model || "Mammotion", state.firmware ? `FW ${state.firmware}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", style.pill)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
          {statusText}
        </span>
      </div>

      {map && map.areas.length > 0 && (
        <div className={cn("relative mt-3 overflow-hidden rounded-xl p-1.5", inverted ? "bg-emerald-950/45 ring-1 ring-white/10" : "bg-emerald-950/[0.04] dark:bg-black/20")}>
          <MowerMapView map={map} state={stale ? null : state} tone={tone} label={device.name} />
        </div>
      )}

      <div className="relative mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <div>
          <p className={cn("mb-0.5", inverted ? "text-white/70" : "text-muted-foreground")}>Akku</p>
          <BatteryBar value={state.battery} charging={state.charging} inverted={inverted} />
        </div>
        {state.active && state.progress != null ? (
          <div>
            <p className={cn("mb-0.5", inverted ? "text-white/70" : "text-muted-foreground")}>
              Fortschritt{state.currentZone ? ` · ${state.currentZone}` : ""}
            </p>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-1.5 flex-1 overflow-hidden rounded-full", inverted ? "bg-white/25" : "bg-muted")}>
                <div className={cn("h-full rounded-full", inverted ? "bg-white" : "bg-emerald-500")} style={{ width: `${state.progress}%` }} />
              </div>
              <span className="text-xs font-semibold tabular-nums">{Math.round(state.progress)} %</span>
            </div>
          </div>
        ) : (
          <div>
            <p className={cn("mb-0.5", inverted ? "text-white/70" : "text-muted-foreground")}>Nächste Mahd</p>
            <p className="flex items-center gap-1 text-xs font-semibold">
              <CalendarClock className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {next ? next.label : "kein Plan"}
            </p>
          </div>
        )}
      </div>

      {state.tasks.length > 0 && (
        <div className="relative mt-3 space-y-1">
          {state.tasks.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-2 rounded-xl px-2 py-1.5 text-[11px]",
                inverted ? "bg-white/10" : "bg-muted/50",
                !t.enabled && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {t.name}
                  {t.running && <span className={cn("ml-1.5 font-semibold", inverted ? "text-white" : "text-emerald-600")}>läuft</span>}
                  {!t.enabled && <span className="ml-1.5 text-muted-foreground">pausiert</span>}
                </p>
                <p className={cn("truncate", inverted ? "text-white/70" : "text-muted-foreground")}>
                  {[weekdaysLabel(t.weekdays), t.startTime, t.bladeHeightMm ? `${t.bladeHeightMm} mm` : null, t.zones.join(", ")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canControl && !state.active && (
                <ActionButton
                  onClick={() => void run("start_task", t.id)}
                  busy={busy === `start_task:${t.id}`}
                  disabled={busy !== null}
                  icon={<Play className="h-3.5 w-3.5" />}
                  inverted={inverted}
                >
                  Jetzt
                </ActionButton>
              )}
            </div>
          ))}
        </div>
      )}

      {canControl && (state.active || !state.charging) && (
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {working && (
            <ActionButton onClick={() => void run("pause")} busy={busy === "pause"} disabled={busy !== null} icon={<Pause className="h-3.5 w-3.5" />} inverted={inverted} primary>
              Pause
            </ActionButton>
          )}
          {paused && (
            <ActionButton onClick={() => void run("resume")} busy={busy === "resume"} disabled={busy !== null} icon={<Play className="h-3.5 w-3.5" />} inverted={inverted} primary>
              Fortsetzen
            </ActionButton>
          )}
          {state.active && (
            <ActionButton onClick={() => void run("stop")} busy={busy === "stop"} disabled={busy !== null} icon={<Square className="h-3.5 w-3.5" />} inverted={inverted}>
              Beenden
            </ActionButton>
          )}
          {!state.charging && (
            <ActionButton onClick={() => void run("dock")} busy={busy === "dock"} disabled={busy !== null} icon={<Home className="h-3.5 w-3.5" />} inverted={inverted}>
              Zur Station
            </ActionButton>
          )}
        </div>
      )}

      {state.errors.length > 0 && (
        <div className="relative mt-2 space-y-0.5">
          {state.errors.map((e) => (
            <p key={e.code} className={cn("flex items-start gap-1 text-[11px]", inverted ? "text-white" : "text-destructive")}>
              <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
              {e.text || `Fehler ${e.code}`}
            </p>
          ))}
        </div>
      )}

      <p className={cn("relative mt-2 text-[10px]", message?.error ? "text-destructive" : inverted ? "text-white/70" : "text-muted-foreground")}>
        {message ? message.text : lastUpdate ? `Stand ${fmtAgo(lastUpdate, nowMs)} · über den Hub` : "über den Hub"}
      </p>
    </div>
  );
}
