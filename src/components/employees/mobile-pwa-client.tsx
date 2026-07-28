"use client";

import { createElement, useEffect, useMemo, useState, useCallback } from "react";
import {
  DoorOpen, Lock, Loader2, AlertTriangle, CheckCircle2, XCircle, Clock,
  Power, PowerOff, Lightbulb, ToggleRight, GitMerge, Activity, KeyRound,
  RefreshCw, ChevronDown, Building2, Umbrella, Blinds, Square,
  ArrowUpFromLine, ArrowDownToLine, Droplets,
} from "lucide-react";
import {
  deviceControlModel,
  deviceControls,
  type DeviceControlAction,
  type DeviceControlModel,
} from "@/lib/device-controls";
import { cn } from "@/lib/utils";
import {
  parseSchedule, DAY_KEYS, DAY_LABELS, hasAnySchedule,
} from "@/lib/schedule";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MobileDevice {
  id: number;
  name: string;
  type: string;
  category: string | null;
  via: "direct" | "area";
}

interface MobileProfile {
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  profileImage: string | null;
  accountName: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  weekSchedule: unknown;
  contractOk: boolean;
  contractReason: string | null;
  scheduleCheck: { ok: boolean; reason?: string } | null;
  devices: MobileDevice[];
}

interface Props {
  token: string;
  profile: MobileProfile;
}

type ActionKey = DeviceControlAction;

// ─── Action Defs ─────────────────────────────────────────────────────────────

interface PrimaryAction {
  key: ActionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /// Tailwind gradient classes fuer den Primaerbutton.
  gradient: string;
}

interface SecondaryAction {
  key: ActionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "danger" | "neutral";
}

interface DeviceActions {
  primary: PrimaryAction;
  /// Zusatzbefehle links neben dem Hauptbutton, in Anzeigereihenfolge.
  secondary?: SecondaryAction[];
}

/** Symbol je Bedienmodell und Aktion – die Beschriftungen kommen aus der Lib. */
function controlIcon(
  model: DeviceControlModel,
  action: DeviceControlAction,
): React.ComponentType<{ className?: string }> {
  if (model === "COVER") {
    if (action === "open") return ArrowUpFromLine;
    if (action === "close") return ArrowDownToLine;
    return Square;
  }
  if (model === "SWITCH" || model === "LIGHT") {
    return action === "open" ? Power : PowerOff;
  }
  if (model === "LOCK") return action === "open" ? DoorOpen : Lock;
  if (model === "VALVE") return action === "open" ? Droplets : Square;
  if (action === "emergency") return AlertTriangle;
  return DoorOpen;
}

const PRIMARY_GRADIENT: Partial<Record<DeviceControlModel, string>> = {
  SWITCH: "from-amber-400 to-amber-600",
  LIGHT: "from-amber-400 to-amber-600",
  VALVE: "from-sky-400 to-sky-600",
};

/**
 * Bedienelemente eines Geraets. Welche Aktionen es gibt und wie sie heissen,
 * legt `src/lib/device-controls.ts` fest – dieselbe Quelle, aus der die API
 * ihre Angaben speist. Hier kommen nur Symbol und Farbe dazu.
 */
function actionsFor(device: MobileDevice): DeviceActions | null {
  const controls = deviceControls(device);
  if (controls.length === 0) return null;

  const model = deviceControlModel(device);
  const [primary, ...rest] = controls;

  return {
    primary: {
      key: primary.action,
      label: primary.label,
      icon: controlIcon(model, primary.action),
      gradient: PRIMARY_GRADIENT[model] ?? "from-emerald-400 to-emerald-600",
    },
    secondary: rest.length > 0
      ? rest.map((c) => ({
          key: c.action,
          label: c.label,
          icon: controlIcon(model, c.action),
          tone: c.role === "danger" ? ("danger" as const) : ("neutral" as const),
        }))
      : undefined,
  };
}

function deviceIcon(device: MobileDevice) {
  if (device.type === "NUKI_SMARTLOCK" || device.type === "LOQED_SMARTLOCK") return KeyRound;
  if (device.category === "DREHKREUZ") return GitMerge;
  if (device.category === "TUER") return DoorOpen;
  if (device.category === "BELEUCHTUNG") return Lightbulb;
  if (device.category === "SCHALTER") return ToggleRight;
  if (device.category === "SENSOR") return Activity;
  if (device.category === "MARKISE") return Umbrella;
  if (device.category === "ROLLTOR") return Blinds;
  return DoorOpen;
}

function categoryMeta(cat: string | null, type: string | null) {
  if (type === "NUKI_SMARTLOCK" || type === "LOQED_SMARTLOCK") {
    return { label: "Smart Locks", accent: "rose", order: 1 };
  }
  switch (cat) {
    case "TUER":        return { label: "Türen",        accent: "sky",     order: 0 };
    case "DREHKREUZ":   return { label: "Drehkreuze",   accent: "indigo",  order: 2 };
    case "SCHALTER":    return { label: "Schalter",     accent: "amber",   order: 3 };
    case "BELEUCHTUNG": return { label: "Beleuchtung",  accent: "yellow",  order: 4 };
    case "MARKISE":     return { label: "Markisen",     accent: "teal",    order: 5 };
    case "ROLLTOR":     return { label: "Rolltore",     accent: "slate",   order: 6 };
    case "SENSOR":      return { label: "Sensoren",     accent: "emerald", order: 7 };
    default:            return { label: "Sonstige",     accent: "slate",   order: 9 };
  }
}

const ACCENT_CLS: Record<string, { bg: string; text: string; ring: string }> = {
  rose:    { bg: "bg-rose-500/10",    text: "text-rose-600 dark:text-rose-400",       ring: "ring-rose-200/50 dark:ring-rose-900/40" },
  sky:     { bg: "bg-sky-500/10",     text: "text-sky-600 dark:text-sky-400",         ring: "ring-sky-200/50 dark:ring-sky-900/40" },
  indigo:  { bg: "bg-indigo-500/10",  text: "text-indigo-600 dark:text-indigo-400",   ring: "ring-indigo-200/50 dark:ring-indigo-900/40" },
  amber:   { bg: "bg-amber-500/10",   text: "text-amber-600 dark:text-amber-400",     ring: "ring-amber-200/50 dark:ring-amber-900/40" },
  yellow:  { bg: "bg-yellow-500/10",  text: "text-yellow-600 dark:text-yellow-400",   ring: "ring-yellow-200/50 dark:ring-yellow-900/40" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-200/50 dark:ring-emerald-900/40" },
  teal:    { bg: "bg-teal-500/10",    text: "text-teal-600 dark:text-teal-400",       ring: "ring-teal-200/50 dark:ring-teal-900/40" },
  slate:   { bg: "bg-slate-500/10",   text: "text-slate-600 dark:text-slate-400",     ring: "ring-slate-200/50 dark:ring-slate-700" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MobileAccessClient({ token, profile }: Props) {
  const [scheduleCheck, setScheduleCheck] = useState(profile.scheduleCheck);
  const [feedback, setFeedback] = useState<{ id: string; type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.name;
  const initials = ((profile.firstName?.[0] ?? profile.name[0] ?? "?") + (profile.lastName?.[0] ?? "")).toUpperCase();
  const schedule = parseSchedule(profile.weekSchedule);
  const scheduleConfigured = hasAnySchedule(schedule);
  const isAllowed = profile.contractOk && (!scheduleCheck || scheduleCheck.ok);

  // Gerate nach Kategorie gruppieren.
  const grouped = useMemo(() => {
    const map = new Map<string, { meta: ReturnType<typeof categoryMeta>; devices: MobileDevice[] }>();
    for (const d of profile.devices) {
      const meta = categoryMeta(d.category, d.type);
      const cur = map.get(meta.label) ?? { meta, devices: [] };
      cur.devices.push(d);
      map.set(meta.label, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.meta.order - b.meta.order);
  }, [profile.devices]);

  // Live-Refresh des Schedule-Checks.
  const refreshProfile = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/m/${token}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setScheduleCheck(data.scheduleCheck ?? null);
      }
    } catch {
      /* offline ok */
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    const t = setInterval(refreshProfile, 60_000);
    return () => clearInterval(t);
  }, [refreshProfile]);

  async function handleAction(device: MobileDevice, action: ActionKey) {
    const key = `${device.id}:${action}`;
    setLoading(key);
    setFeedback(null);
    try {
      const res = await fetch(`/api/m/${token}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFeedback({ id: key, type: "ok", text: device.name });
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(40);
      } else {
        setFeedback({ id: key, type: "err", text: data.error ?? `Fehler (${res.status})` });
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([60, 30, 60]);
      }
    } catch {
      setFeedback({ id: key, type: "err", text: "Offline – nicht erreichbar" });
    } finally {
      setLoading(null);
      setTimeout(() => setFeedback((f) => (f?.id === key ? null : f)), 3500);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-md min-h-[100dvh] flex flex-col text-slate-900 dark:text-slate-100">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600" />
        <div className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-12 -left-6 h-32 w-32 rounded-full bg-fuchsia-300/20 blur-2xl" />

        <div className="relative px-4 pt-3 pb-3.5 text-white">
          {/* Top-Row: Tenant + Live */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-medium text-white/70 inline-flex items-center gap-1">
              <Building2 className="h-2.5 w-2.5" /> {profile.accountName}
            </p>
            <button
              type="button"
              onClick={refreshProfile}
              disabled={refreshing}
              className="h-5 inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-2 text-[9px] font-medium text-white/90 backdrop-blur transition disabled:opacity-50"
              aria-label="Aktualisieren"
            >
              <RefreshCw className={cn("h-2.5 w-2.5", refreshing && "animate-spin")} />
              live
            </button>
          </div>

          {/* Avatar + Name + Status auf einer Zeile */}
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden">
              {profile.profileImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.profileImage} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold leading-tight truncate">{fullName}</h1>
              <p className="text-[10px] text-white/70 truncate">
                {profile.ticketTypeName ?? "Mitarbeiter"}
                {profile.endDate && <> · bis {fmtDate(profile.endDate)}</>}
              </p>
            </div>
            {/* Status als Inline-Dot */}
            <HeaderStatusDot
              kind={!profile.contractOk ? "err" : scheduleCheck && !scheduleCheck.ok ? "warn" : "ok"}
              label={
                !profile.contractOk ? (profile.contractReason ?? "Kein Zutritt")
                : scheduleCheck && !scheduleCheck.ok ? (scheduleCheck.reason ?? "Ausserhalb Zeit")
                : "Aktiv"
              }
            />
          </div>
        </div>
      </header>

      {/* ─── Schedule Card (collapsible) ─────────────────────────────── */}
      {scheduleConfigured && (
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={() => setScheduleOpen((o) => !o)}
            className={cn(
              "w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800",
              "px-3 py-1.5 flex items-center justify-between text-xs transition-colors",
              scheduleCheck && !scheduleCheck.ok && "ring-1 ring-amber-300 dark:ring-amber-900/60",
            )}
          >
            <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
              <Clock className="h-3 w-3 text-amber-500" />
              Arbeitszeiten
            </span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", scheduleOpen && "rotate-180")} />
          </button>
          {scheduleOpen && (
            <div className="mt-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-1">
              {DAY_KEYS.map((d) => {
                const cfg = schedule[d];
                return (
                  <div key={d} className={cn(
                    "flex items-center justify-between text-xs py-0.5 px-2",
                    !cfg.enabled && "opacity-40",
                  )}>
                    <span className="font-medium text-slate-700 dark:text-slate-300 w-8 text-[11px]">{DAY_LABELS[d]}</span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {cfg.enabled ? `${cfg.on || "00:00"} – ${cfg.off || "24:00"}` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Devices grouped ─────────────────────────────────────────── */}
      <main className="px-3 pt-2 pb-16 flex-1 space-y-2.5">
        {profile.devices.length === 0 && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-400">
            Keine Geräte freigegeben.
          </div>
        )}

        {grouped.map((group) => (
          <section key={group.meta.label}>
            <div className="flex items-center justify-between px-2 pb-1">
              <h2 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {group.meta.label}
              </h2>
              <span className="text-[9px] text-slate-400">{group.devices.length}</span>
            </div>

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
              {group.devices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  loading={loading}
                  feedback={feedback}
                  enabled={isAllowed}
                  onAction={handleAction}
                />
              ))}
            </div>
          </section>
        ))}
      </main>

      <footer className="mt-auto px-4 pb-2 text-center text-[9px] text-slate-400">
        EMP Access
      </footer>
    </div>
  );
}

// ─── DeviceRow ───────────────────────────────────────────────────────────────

interface DeviceRowProps {
  device: MobileDevice;
  loading: string | null;
  feedback: { id: string; type: "ok" | "err"; text: string } | null;
  enabled: boolean;
  onAction: (device: MobileDevice, action: ActionKey) => void;
}

function DeviceRow({ device, loading, feedback, enabled, onAction }: DeviceRowProps) {
  const iconComp = deviceIcon(device);
  const actions = actionsFor(device);
  const meta = categoryMeta(device.category, device.type);
  const accent = ACCENT_CLS[meta.accent] ?? ACCENT_CLS.slate;

  // Pro Device: zeigen wir den letzten Feedback-Status der primary action.
  const primaryFb = feedback?.id === `${device.id}:${actions?.primary.key}` ? feedback : null;
  const primaryLoading = loading === `${device.id}:${actions?.primary.key}`;

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5">
      {/* Icon */}
      <div className={cn(
        "h-7 w-7 rounded-lg flex items-center justify-center shrink-0",
        accent.bg, accent.text,
      )}>
        {createElement(iconComp, { className: "h-3.5 w-3.5" })}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p
          className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate leading-tight"
          title={device.via === "direct" ? `${device.name} · Direktzugang` : `${device.name} · via Bereich`}
        >
          {device.name}
        </p>
      </div>

      {/* Actions */}
      {actions === null ? (
        <span className="text-[9px] text-slate-400 italic shrink-0 pr-1">—</span>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          {actions.secondary?.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => onAction(device, action.key)}
              disabled={!enabled || loading !== null}
              aria-label={action.label}
              title={action.label}
              className={cn(
                "h-7 w-7 rounded-lg flex items-center justify-center transition active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed",
                action.tone === "danger"
                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                  : "bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20",
              )}
            >
              {loading === `${device.id}:${action.key}`
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : createElement(action.icon, { className: "h-3.5 w-3.5" })}
            </button>
          ))}

          <button
            type="button"
            onClick={() => onAction(device, actions.primary.key)}
            disabled={!enabled || loading !== null}
            className={cn(
              "h-7 px-2.5 rounded-lg text-white text-[12px] font-semibold inline-flex items-center justify-center gap-1",
              "active:scale-95 transition-transform bg-gradient-to-b",
              primaryFb?.type === "ok" ? "from-emerald-500 to-emerald-700" :
              primaryFb?.type === "err" ? "from-rose-500 to-rose-700" :
              actions.primary.gradient,
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-500",
            )}
          >
            {primaryLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : primaryFb?.type === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : primaryFb?.type === "err" ? (
              <XCircle className="h-3.5 w-3.5" />
            ) : (
              createElement(actions.primary.icon, { className: "h-3.5 w-3.5" })
            )}
            <span className="whitespace-nowrap">
              {primaryFb?.type === "ok" ? "OK" : primaryFb?.type === "err" ? "Fehler" : actions.primary.label}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── HeaderStatusDot ─────────────────────────────────────────────────────────

function HeaderStatusDot({ kind, label }: { kind: "ok" | "warn" | "err"; label: string }) {
  const cls = kind === "ok"
    ? "bg-emerald-400/25 text-emerald-50 ring-emerald-200/40"
    : kind === "warn"
      ? "bg-amber-400/25 text-amber-50 ring-amber-200/40"
      : "bg-rose-400/25 text-rose-50 ring-rose-200/40";
  const dot = kind === "ok" ? "bg-emerald-300" : kind === "warn" ? "bg-amber-300" : "bg-rose-300";
  return (
    <div
      title={label}
      className={cn("inline-flex items-center gap-1.5 rounded-full ring-1 backdrop-blur px-2 py-1 shrink-0", cls)}
    >
      <span className="relative flex h-1.5 w-1.5">
        {kind === "ok" && <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-60", dot)} />}
        <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", dot)} />
      </span>
      <span className="text-[10px] font-semibold whitespace-nowrap max-w-[120px] truncate">{label}</span>
    </div>
  );
}
