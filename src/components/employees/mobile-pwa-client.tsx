"use client";

import { createElement, useEffect, useMemo, useState, useCallback } from "react";
import {
  DoorOpen, Lock, Loader2, AlertTriangle, CheckCircle2, XCircle, Clock,
  Power, PowerOff, Lightbulb, ToggleRight, GitMerge, Activity, KeyRound,
  RefreshCw, ShieldOff, ChevronDown, Sparkles, Building2,
} from "lucide-react";
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

type ActionKey = "open" | "deactivate" | "reset" | "emergency";

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
  secondary?: SecondaryAction;
}

function actionsFor(device: MobileDevice): DeviceActions | null {
  const cat = device.category;

  if (cat === "SENSOR") return null;

  if (cat === "SCHALTER" || cat === "BELEUCHTUNG") {
    return {
      primary: {
        key: "open",
        label: cat === "BELEUCHTUNG" ? "Anschalten" : "Ein",
        icon: Power,
        gradient: "from-amber-400 to-amber-600",
      },
      secondary: {
        key: "reset",
        label: cat === "BELEUCHTUNG" ? "Aus" : "Aus",
        icon: PowerOff,
        tone: "neutral",
      },
    };
  }

  if (device.type === "NUKI_SMARTLOCK") {
    return {
      primary: {
        key: "open",
        label: "Tür öffnen",
        icon: DoorOpen,
        gradient: "from-emerald-400 to-emerald-600",
      },
      secondary: {
        key: "deactivate",
        label: "Abschließen",
        icon: Lock,
        tone: "neutral",
      },
    };
  }

  if (cat === "DREHKREUZ") {
    return {
      primary: {
        key: "open",
        label: "Öffnen",
        icon: DoorOpen,
        gradient: "from-emerald-400 to-emerald-600",
      },
      secondary: {
        key: "emergency",
        label: "NOT-AUF",
        icon: AlertTriangle,
        tone: "danger",
      },
    };
  }

  // TUER (Pi-Tuer, kein Drehkreuz)
  return {
    primary: {
      key: "open",
      label: "Öffnen",
      icon: DoorOpen,
      gradient: "from-emerald-400 to-emerald-600",
    },
  };
}

function deviceIcon(device: MobileDevice) {
  if (device.type === "NUKI_SMARTLOCK") return KeyRound;
  if (device.category === "DREHKREUZ") return GitMerge;
  if (device.category === "TUER") return DoorOpen;
  if (device.category === "BELEUCHTUNG") return Lightbulb;
  if (device.category === "SCHALTER") return ToggleRight;
  if (device.category === "SENSOR") return Activity;
  return DoorOpen;
}

function categoryMeta(cat: string | null, type: string | null) {
  if (type === "NUKI_SMARTLOCK") {
    return { label: "Smart Locks", accent: "rose", order: 1 };
  }
  switch (cat) {
    case "TUER":        return { label: "Türen",        accent: "sky",     order: 0 };
    case "DREHKREUZ":   return { label: "Drehkreuze",   accent: "indigo",  order: 2 };
    case "SCHALTER":    return { label: "Schalter",     accent: "amber",   order: 3 };
    case "BELEUCHTUNG": return { label: "Beleuchtung",  accent: "yellow",  order: 4 };
    case "SENSOR":      return { label: "Sensoren",     accent: "emerald", order: 5 };
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
        <div className="absolute -top-24 -right-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-fuchsia-300/20 blur-3xl" />

        <div className="relative px-5 pt-6 pb-5 text-white">
          {/* Tenant + Live-Pill */}
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-white/70 inline-flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> {profile.accountName}
            </p>
            <button
              type="button"
              onClick={refreshProfile}
              disabled={refreshing}
              className="h-7 inline-flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 px-2.5 text-[10px] font-medium text-white/90 backdrop-blur transition disabled:opacity-50"
              aria-label="Aktualisieren"
            >
              <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
              live
            </button>
          </div>

          {/* Avatar + Name */}
          <div className="mt-4 flex items-center gap-3.5">
            <div className="h-14 w-14 rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur flex items-center justify-center text-lg font-bold shrink-0 overflow-hidden">
              {profile.profileImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.profileImage} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold leading-tight truncate">{fullName}</h1>
              <p className="text-xs text-white/70 mt-0.5 truncate">
                {profile.ticketTypeName ?? "Mitarbeiter"}
                {profile.endDate && (
                  <>
                    <span className="mx-1.5 opacity-50">·</span>
                    <span>bis {fmtDate(profile.endDate)}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Status pill */}
          <div className="mt-4">
            {!profile.contractOk ? (
              <StatusPill kind="err" icon={ShieldOff} text={profile.contractReason ?? "Kein Zutritt"} />
            ) : scheduleCheck && !scheduleCheck.ok ? (
              <StatusPill kind="warn" icon={Clock} text={scheduleCheck.reason ?? "Ausserhalb der Zeit"} />
            ) : (
              <StatusPill kind="ok" icon={Sparkles} text="Zugriff freigegeben" />
            )}
          </div>
        </div>
      </header>

      {/* ─── Schedule Card (collapsible) ─────────────────────────────── */}
      {scheduleConfigured && (
        <div className="px-4 -mt-3 relative z-10">
          <button
            type="button"
            onClick={() => setScheduleOpen((o) => !o)}
            className={cn(
              "w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg",
              "px-4 py-2.5 flex items-center justify-between text-sm transition-colors",
              scheduleCheck && !scheduleCheck.ok
                ? "ring-2 ring-amber-300 dark:ring-amber-900/60"
                : "",
            )}
          >
            <span className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
              <Clock className="h-4 w-4 text-amber-500" />
              Arbeitszeiten
            </span>
            <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", scheduleOpen && "rotate-180")} />
          </button>
          {scheduleOpen && (
            <div className="mt-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-2 shadow">
              {DAY_KEYS.map((d) => {
                const cfg = schedule[d];
                return (
                  <div key={d} className={cn(
                    "flex items-center justify-between text-sm py-1.5 px-2",
                    !cfg.enabled && "opacity-40",
                  )}>
                    <span className="font-medium text-slate-700 dark:text-slate-300 w-10">{DAY_LABELS[d]}</span>
                    <span className="text-xs font-mono text-slate-500">
                      {cfg.enabled
                        ? `${cfg.on || "00:00"} – ${cfg.off || "24:00"}`
                        : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Devices grouped ─────────────────────────────────────────── */}
      <main className="px-4 pt-4 pb-24 flex-1 space-y-5">
        {profile.devices.length === 0 && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400">
            Keine Geräte freigegeben.
          </div>
        )}

        {grouped.map((group) => (
          <section key={group.meta.label} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {group.meta.label}
              </h2>
              <span className="text-[10px] text-slate-400">{group.devices.length}</span>
            </div>

            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden shadow-sm">
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

      {/* Footer */}
      <footer className="mt-auto px-5 py-3 text-center text-[10px] text-slate-400">
        EMP Access · Persönlicher Zugang
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
  const secondaryLoading = actions?.secondary && loading === `${device.id}:${actions.secondary.key}`;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      {/* Icon */}
      <div className={cn(
        "h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ring-1",
        accent.bg, accent.text, accent.ring,
      )}>
        {createElement(iconComp, { className: "h-5 w-5" })}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0 mr-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate leading-tight">
          {device.name}
        </p>
        <p className="text-[10px] text-slate-400 truncate mt-0.5">
          {device.via === "direct" ? "Direktzugang" : "via Bereich"}
        </p>
      </div>

      {/* Actions */}
      {actions === null ? (
        <span className="text-[10px] text-slate-400 italic shrink-0 pr-1">nur Anzeige</span>
      ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Secondary (klein, icon-only) */}
          {actions.secondary && (
            <button
              type="button"
              onClick={() => onAction(device, actions.secondary!.key)}
              disabled={!enabled || loading !== null}
              aria-label={actions.secondary.label}
              title={actions.secondary.label}
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center transition active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed",
                actions.secondary.tone === "danger"
                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-300/50 dark:ring-rose-900/50 hover:bg-rose-500/20"
                  : "bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-1 ring-slate-300/50 dark:ring-slate-700 hover:bg-slate-500/20",
              )}
            >
              {secondaryLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <actions.secondary.icon className="h-4 w-4" />}
            </button>
          )}

          {/* Primary (full-color) */}
          <button
            type="button"
            onClick={() => onAction(device, actions.primary.key)}
            disabled={!enabled || loading !== null}
            className={cn(
              "h-10 min-w-[88px] px-3.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5",
              "shadow-sm shadow-emerald-900/10 active:scale-95 transition-transform",
              "bg-gradient-to-b",
              primaryFb?.type === "ok" ? "from-emerald-500 to-emerald-700" :
              primaryFb?.type === "err" ? "from-rose-500 to-rose-700" :
              actions.primary.gradient,
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-500 disabled:shadow-none",
            )}
          >
            {primaryLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : primaryFb?.type === "ok" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : primaryFb?.type === "err" ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <actions.primary.icon className="h-4 w-4" />
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

// ─── StatusPill ──────────────────────────────────────────────────────────────

function StatusPill({
  kind, icon: Icon, text,
}: {
  kind: "ok" | "warn" | "err";
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  const cls = kind === "ok"
    ? "bg-emerald-400/20 border-emerald-200/30 text-emerald-50"
    : kind === "warn"
      ? "bg-amber-400/20 border-amber-200/30 text-amber-50"
      : "bg-rose-400/20 border-rose-200/30 text-rose-50";
  const dot = kind === "ok" ? "bg-emerald-300" : kind === "warn" ? "bg-amber-300" : "bg-rose-300";
  return (
    <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur", cls)}>
      <span className="relative flex h-2 w-2">
        {kind === "ok" && <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-60", dot)} />}
        <span className={cn("relative inline-flex rounded-full h-2 w-2", dot)} />
      </span>
      <Icon className="h-3.5 w-3.5" />
      <span className="text-xs font-semibold">{text}</span>
    </div>
  );
}
