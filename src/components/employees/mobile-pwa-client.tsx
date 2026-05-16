"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DoorOpen, Lock, Loader2, AlertTriangle, CheckCircle2, XCircle, Clock,
  Power, PowerOff, Lightbulb, ToggleRight, GitMerge, Activity, Wifi,
  Calendar, IdCard, RefreshCw, ShieldOff, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  parseSchedule, DAY_KEYS, DAY_LABELS, hasAnySchedule,
} from "@/lib/schedule";

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

interface ActionButton {
  key: ActionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

function actionsFor(device: MobileDevice): ActionButton[] {
  const cat = device.category;
  // Schalter / Beleuchtung: simples Ein/Aus.
  if (cat === "SCHALTER" || cat === "BELEUCHTUNG") {
    return [
      { key: "open", label: cat === "BELEUCHTUNG" ? "Einschalten" : "Ein", icon: Power, color: "bg-amber-500 hover:bg-amber-600" },
      { key: "reset", label: cat === "BELEUCHTUNG" ? "Ausschalten" : "Aus", icon: PowerOff, color: "bg-slate-700 hover:bg-slate-800" },
    ];
  }
  // Sensoren: keine Aktion.
  if (cat === "SENSOR") return [];
  // Nuki: Oeffnen / Abschliessen.
  if (device.type === "NUKI_SMARTLOCK") {
    return [
      { key: "open", label: "Tür öffnen", icon: DoorOpen, color: "bg-emerald-600 hover:bg-emerald-700" },
      { key: "deactivate", label: "Abschließen", icon: Lock, color: "bg-slate-700 hover:bg-slate-800" },
    ];
  }
  // Drehkreuz / Tuer (Pi-basiert oder ohne Kategorie).
  if (cat === "DREHKREUZ") {
    return [
      { key: "open", label: "Öffnen", icon: DoorOpen, color: "bg-emerald-600 hover:bg-emerald-700" },
      { key: "emergency", label: "NOT-AUF", icon: AlertTriangle, color: "bg-rose-600 hover:bg-rose-700" },
    ];
  }
  // Default fuer TUER und unkategorisierte Zugangsgeraete.
  return [
    { key: "open", label: "Öffnen", icon: DoorOpen, color: "bg-emerald-600 hover:bg-emerald-700" },
  ];
}

function deviceIcon(device: MobileDevice) {
  if (device.type === "NUKI_SMARTLOCK") return DoorOpen;
  if (device.category === "DREHKREUZ") return GitMerge;
  if (device.category === "TUER") return DoorOpen;
  if (device.category === "BELEUCHTUNG") return Lightbulb;
  if (device.category === "SCHALTER") return ToggleRight;
  if (device.category === "SENSOR") return Activity;
  return Wifi;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function MobileAccessClient({ token, profile }: Props) {
  const [scheduleCheck, setScheduleCheck] = useState(profile.scheduleCheck);
  const [feedback, setFeedback] = useState<{ id: string; type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.name;
  const initials = ((profile.firstName?.[0] ?? profile.name[0] ?? "?") + (profile.lastName?.[0] ?? "")).toUpperCase();
  const schedule = parseSchedule(profile.weekSchedule);
  const scheduleConfigured = hasAnySchedule(schedule);
  const isAllowed = profile.contractOk && (!scheduleCheck || scheduleCheck.ok);

  // Schedule-Check minuetlich aktualisieren - der Server hat es initial
  // berechnet, aber wenn die PWA installiert offen bleibt, muessen die
  // Buttons trotzdem nach Ablauf "Erst ab 18:00" wieder freigegeben werden.
  const refreshProfile = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/m/${token}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setScheduleCheck(data.scheduleCheck ?? null);
      }
    } catch {
      /* offline ist ok - alter State bleibt */
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
        setFeedback({
          id: key,
          type: "ok",
          text: action === "open" ? `${device.name} geöffnet` : action === "deactivate" ? `${device.name} abgeschlossen` : `${device.name}: ${action}`,
        });
        // Kurz vibrieren als haptisches Feedback (Mobile-only).
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(40);
      } else {
        setFeedback({ id: key, type: "err", text: data.error ?? `Fehler (${res.status})` });
      }
    } catch {
      setFeedback({ id: key, type: "err", text: "Netzwerkfehler" });
    } finally {
      setLoading(null);
      setTimeout(() => setFeedback((f) => (f?.id === key ? null : f)), 4000);
    }
  }

  return (
    <div className="mx-auto max-w-md min-h-[100dvh] flex flex-col">
      {/* Header */}
      <header className="px-5 pt-8 pb-6 bg-gradient-to-br from-indigo-600 to-indigo-700 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-white/10 ring-2 ring-white/30 flex items-center justify-center overflow-hidden text-xl font-bold shrink-0">
            {profile.profileImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.profileImage} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-indigo-200 inline-flex items-center gap-1">
              <Building2 className="h-3 w-3" /> {profile.accountName}
            </p>
            <h1 className="text-xl font-bold truncate">{fullName}</h1>
            <p className="text-xs text-indigo-200 inline-flex items-center gap-1">
              <IdCard className="h-3 w-3" /> {profile.ticketTypeName ?? "Mitarbeiter"}
            </p>
          </div>
        </div>

        {/* Status-Banner */}
        <div className="mt-5">
          {!profile.contractOk ? (
            <StatusBanner kind="err" icon={ShieldOff} title={profile.contractReason ?? "Kein Zutritt"} text="Bitte den Vorgesetzten kontaktieren." />
          ) : scheduleCheck && !scheduleCheck.ok ? (
            <StatusBanner kind="warn" icon={Clock} title="Außerhalb der freigegebenen Zeit" text={scheduleCheck.reason ?? ""} />
          ) : (
            <StatusBanner kind="ok" icon={CheckCircle2} title="Zutritt aktiv" text={profile.endDate ? `Gültig bis ${fmtDate(profile.endDate)}` : "unbefristet"} />
          )}
        </div>
      </header>

      {/* Schedule-Karte */}
      {scheduleConfigured && (
        <details className="px-5 mt-4 group" open={!isAllowed && !!scheduleCheck}>
          <summary className="cursor-pointer flex items-center justify-between rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <span className="inline-flex items-center gap-2 font-medium">
              <Clock className="h-4 w-4" /> Arbeitszeiten
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-500">
              {scheduleCheck && !scheduleCheck.ok ? "gerade gesperrt" : "anzeigen"}
            </span>
          </summary>
          <div className="mt-2 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-white dark:bg-slate-900 p-3 space-y-1">
            {DAY_KEYS.map((d) => {
              const cfg = schedule[d];
              return (
                <div key={d} className={cn(
                  "flex items-center justify-between text-sm py-1 px-2 rounded-md",
                  cfg.enabled ? "bg-amber-50/60 dark:bg-amber-950/20" : "opacity-50",
                )}>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{DAY_LABELS[d]}</span>
                  <span className="text-xs font-mono text-slate-500">
                    {cfg.enabled ? `${cfg.on || "00:00"} – ${cfg.off || "24:00"}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Vertrag */}
      <div className="px-5 mt-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 flex items-center gap-3 text-sm">
          <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-slate-700 dark:text-slate-300">
              {fmtDate(profile.startDate)}
              <span className="text-slate-400 mx-1.5">–</span>
              {profile.endDate ? fmtDate(profile.endDate) : "unbefristet"}
            </p>
          </div>
        </div>
      </div>

      {/* Devices */}
      <main className="px-5 pt-5 pb-32 flex-1 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ihre Geräte ({profile.devices.length})
          </h2>
          <button
            type="button"
            onClick={refreshProfile}
            className="text-xs text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 disabled:opacity-50"
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            Aktualisieren
          </button>
        </div>

        {profile.devices.length === 0 && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400">
            Keine Geräte freigegeben. Bitte den Vorgesetzten kontaktieren.
          </div>
        )}

        {profile.devices.map((device) => {
          const Icon = deviceIcon(device);
          const actions = actionsFor(device);
          const isSensor = device.category === "SENSOR";

          return (
            <div key={device.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <div className={cn(
                  "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                  device.via === "direct"
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                    : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{device.name}</p>
                  <p className="text-xs text-slate-500">
                    {device.category ?? device.type.replace("_", " ").toLowerCase()}
                    <span className="ml-1.5 text-slate-400">·</span>
                    <span className="ml-1.5">{device.via === "direct" ? "Direkt" : "via Bereich"}</span>
                  </p>
                </div>
              </div>

              {isSensor ? (
                <p className="px-4 py-4 text-xs text-slate-400 italic">Sensor – nur Anzeige</p>
              ) : (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {actions.map((a) => {
                    const Icon = a.icon;
                    const actionLoading = loading === `${device.id}:${a.key}`;
                    const fb = feedback?.id === `${device.id}:${a.key}` ? feedback : null;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => handleAction(device, a.key)}
                        disabled={!isAllowed || actionLoading || loading !== null}
                        className={cn(
                          "rounded-xl py-4 px-3 flex items-center justify-center gap-2 text-white font-semibold text-sm transition-all shadow",
                          "min-h-[56px] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
                          actions.length === 1 && "col-span-2",
                          fb?.type === "ok" ? "bg-emerald-600" : fb?.type === "err" ? "bg-rose-600" : a.color,
                        )}
                      >
                        {actionLoading ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : fb?.type === "ok" ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : fb?.type === "err" ? (
                          <XCircle className="h-5 w-5" />
                        ) : (
                          <Icon className="h-5 w-5" />
                        )}
                        <span className="truncate">
                          {fb ? fb.text.split(" ")[fb.text.split(" ").length - 1] || a.label : a.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {feedback && feedback.id.startsWith(`${device.id}:`) && feedback.type === "err" && (
                <p className="px-4 pb-3 text-xs text-rose-600 dark:text-rose-400">{feedback.text}</p>
              )}
            </div>
          );
        })}
      </main>

      {/* Footer */}
      <footer className="mt-auto px-5 py-4 text-center text-[10px] text-slate-400 border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur">
        EMP Access · Bei Verlust des Zugangs den Vorgesetzten kontaktieren.
      </footer>
    </div>
  );
}

function StatusBanner({
  kind, icon: Icon, title, text,
}: {
  kind: "ok" | "warn" | "err";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  const cls = kind === "ok"
    ? "bg-emerald-500/20 border-emerald-300/30 text-emerald-50"
    : kind === "warn"
      ? "bg-amber-500/20 border-amber-300/30 text-amber-50"
      : "bg-rose-500/20 border-rose-300/30 text-rose-50";
  return (
    <div className={cn("rounded-xl border px-3 py-2.5 flex items-start gap-2.5", cls)}>
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">{title}</p>
        {text && <p className="text-xs opacity-90 mt-0.5">{text}</p>}
      </div>
    </div>
  );
}
