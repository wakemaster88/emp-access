"use client";

import { createElement, useEffect, useMemo, useState, useCallback } from "react";
import {
  DoorOpen, Lock, LockOpen, Loader2, AlertTriangle, CheckCircle2, XCircle, Clock,
  Power, PowerOff, Lightbulb, ToggleRight, GitMerge, Activity, KeyRound,
  RefreshCw, ChevronDown, Building2, Umbrella, Blinds, Square,
  ArrowUpFromLine, ArrowDownToLine, Droplets, CircleDot, Volume2,
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip, type ChipTone } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";

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
  /// Durchgang (Tuer, Schloss, Drehkreuz): grosse Taste mit 56 px, sonst 44 px.
  large: boolean;
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
  if (model === "PULSE") return action === "open" ? CircleDot : PowerOff;
  // LOQED: „Entriegeln“ (reset) und „Abschließen“ stehen nebeneinander und
  // brauchen zwei verschiedene Symbole.
  if (model === "LOCK") return action === "open" ? DoorOpen : action === "reset" ? LockOpen : Lock;
  if (model === "VALVE") return action === "open" ? Droplets : Square;
  if (model === "AUDIO") return action === "open" ? Volume2 : Square;
  if (action === "emergency") return AlertTriangle;
  return DoorOpen;
}

/**
 * Durchgaenge: Oeffnen ist hier der haeufigste Griff, darum bekommt die
 * Haupttaste 56 px (docs/design-regeln.md, Abschnitt 20).
 */
const PASSAGE_MODELS: DeviceControlModel[] = ["LOCK", "DOOR", "TURNSTILE"];

/**
 * Bedienelemente eines Geraets. Welche Aktionen es gibt und wie sie heissen,
 * legt `src/lib/device-controls.ts` fest – dieselbe Quelle, aus der die API
 * ihre Angaben speist. Hier kommen nur Symbol und Tastengroesse dazu; die
 * Haupttaste ist immer die Primaertaste (Akzentfarbe).
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
      large: PASSAGE_MODELS.includes(model),
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
  if (device.category === "TASTER") return CircleDot;
  if (device.category === "AUDIO" || device.type === "AUDIO_PLAYER") return Volume2;
  return DoorOpen;
}

/**
 * Gruppe und Symbolfarbe je Kategorie. Farbe nur, wo das Zustandsvokabular
 * eine hat (Licht amber, Musik violett, docs/design-regeln.md, Abschnitt 3);
 * alles andere bleibt ruhig grau.
 */
function categoryMeta(cat: string | null, type: string | null): { label: string; tone: ChipTone; order: number } {
  if (type === "NUKI_SMARTLOCK" || type === "LOQED_SMARTLOCK") {
    return { label: "Smart Locks", tone: "neutral", order: 1 };
  }
  switch (cat) {
    case "TUER":        return { label: "Türen",        tone: "neutral", order: 0 };
    case "DREHKREUZ":   return { label: "Drehkreuze",   tone: "neutral", order: 2 };
    case "SCHALTER":    return { label: "Schalter",     tone: "neutral", order: 3 };
    case "TASTER":      return { label: "Taster",       tone: "neutral", order: 4 };
    case "BELEUCHTUNG": return { label: "Beleuchtung",  tone: "light",   order: 5 };
    case "MARKISE":     return { label: "Markisen",     tone: "neutral", order: 6 };
    case "ROLLTOR":     return { label: "Rolltore",     tone: "neutral", order: 7 };
    case "AUDIO":       return { label: "Audio",        tone: "music",   order: 8 };
    case "SENSOR":      return { label: "Sensoren",     tone: "neutral", order: 9 };
    default:            return { label: "Sonstige",     tone: "neutral", order: 10 };
  }
}

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
  // Warum die Tasten gesperrt sind: ausgeschrieben im Hinweis über den
  // Geräten, die Pille im Kopf trägt nur den Zustand.
  const blockedReason = !profile.contractOk
    ? (profile.contractReason ?? "Kein Zutritt")
    : scheduleCheck && !scheduleCheck.ok
      ? (scheduleCheck.reason ?? "Ausserhalb Zeit")
      : null;

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
    // Unten Luft für den Installationshinweis (schwebt über dem Inhalt), aber
    // nur, solange er da ist: der Hinweis ist das Geschwister-Element dahinter
    // (Layout). So liegt auch die Fußzeile über ihm, und ohne Hinweis
    // (installierte App, Desktop) bleibt unten kein leerer Streifen.
    <div className="mx-auto max-w-md min-h-[100dvh] flex flex-col text-foreground has-[~[data-install-banner]]:pb-44">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      {/* Akzentfläche bis unter die Statusleiste: als installierte App zeigt
          iOS die Statusleiste weiß (black-translucent), darum trägt der Kopf
          in Hell und Dunkel die Akzentfarbe und darauf Weiß. Im Dunkeln ist
          der Akzent heller; zu 60 % gedeckt behält Weiß darauf genug Kontrast. */}
      <header className="relative overflow-hidden rounded-b-card bg-primary text-primary-foreground dark:bg-primary/60">
        <div aria-hidden className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div aria-hidden className="absolute -bottom-12 -left-6 h-32 w-32 rounded-full bg-primary-foreground/10 blur-2xl" />

        <div className="relative px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-4">
          {/* Top-Row: Tenant + Live */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-[11px] font-medium text-primary-foreground/75 inline-flex items-center gap-1">
              <Building2 className="h-3 w-3" /> {profile.accountName}
            </p>
            <button
              type="button"
              onClick={refreshProfile}
              disabled={refreshing}
              className="press relative h-8 shrink-0 inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 hover:bg-primary-foreground/25 px-3 text-[11px] font-semibold text-primary-foreground ring-1 ring-inset ring-primary-foreground/25 outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/70 after:absolute after:-inset-1.5 after:content-[''] disabled:opacity-50"
              aria-label="Aktualisieren"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              live
            </button>
          </div>

          {/* Avatar + Name + Status auf einer Zeile */}
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary-foreground/15 ring-1 ring-primary-foreground/30 flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden">
              {profile.profileImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.profileImage} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold leading-tight tracking-tight truncate">{fullName}</h1>
              <p className="text-xs text-primary-foreground/75 truncate">
                {profile.ticketTypeName ?? "Mitarbeiter"}
                {profile.endDate && <> · bis {fmtDate(profile.endDate)}</>}
              </p>
            </div>
            {/* Status als Inline-Dot */}
            <HeaderStatusDot
              kind={!profile.contractOk ? "err" : scheduleCheck && !scheduleCheck.ok ? "warn" : "ok"}
              label={
                !profile.contractOk ? "Kein Zutritt"
                : scheduleCheck && !scheduleCheck.ok ? "Ausserhalb Zeit"
                : "Aktiv"
              }
            />
          </div>
        </div>
      </header>

      {/* ─── Schedule Card (collapsible) ─────────────────────────────── */}
      {scheduleConfigured && (
        <div className="px-4 pt-4">
          <Card className="gap-0 py-0 sm:py-0">
            <button
              type="button"
              onClick={() => setScheduleOpen((o) => !o)}
              aria-expanded={scheduleOpen}
              className="w-full min-h-12 rounded-card px-4 py-2 flex items-center justify-between gap-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="inline-flex items-center gap-2.5 text-sm font-medium text-foreground">
                <IconChip icon={Clock} tone={scheduleCheck && !scheduleCheck.ok ? "warning" : "neutral"} size="sm" />
                Arbeitszeiten
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", scheduleOpen && "rotate-180")} />
            </button>
            {scheduleOpen && (
              <div className="border-t border-border px-4 py-2">
                {DAY_KEYS.map((d) => {
                  const cfg = schedule[d];
                  return (
                    <div key={d} className={cn(
                      "flex items-center justify-between text-[13px] py-1",
                      !cfg.enabled && "opacity-50",
                    )}>
                      <span className="font-medium text-foreground w-8">{DAY_LABELS[d]}</span>
                      <span className="text-xs font-mono tabular-nums text-muted-foreground">
                        {cfg.enabled ? `${cfg.on || "00:00"} – ${cfg.off || "24:00"}` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─── Devices grouped ─────────────────────────────────────────── */}
      <main className="px-4 pt-4 pb-6 flex-1 space-y-5">
        {blockedReason && (
          <Notice tone={profile.contractOk ? "warning" : "danger"} compact title={blockedReason} />
        )}

        {profile.devices.length === 0 && (
          <Card className="py-0 sm:py-0">
            <EmptyState icon={KeyRound} title="Keine Geräte freigegeben." compact />
          </Card>
        )}

        {grouped.map((group) => (
          <section key={group.meta.label} className="space-y-2">
            <SectionHeading
              title={group.meta.label}
              aside={<span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{group.devices.length}</span>}
              className="px-1"
            />

            <Card className="gap-0 py-1 sm:py-1 divide-y divide-border">
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
            </Card>
          </section>
        ))}
      </main>

      <footer className="mt-auto px-4 pb-3 text-center text-[11px] text-muted-foreground">
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

/**
 * Ein Geraet als Zeile in der Gruppenkarte: oben Symbol und Name, darunter
 * die Tasten in voller Breite – Zusatzbefehle als Glas-Tasten links, die
 * Haupttaste als Primaertaste (44 px, an Durchgaengen 56 px).
 */
function DeviceRow({ device, loading, feedback, enabled, onAction }: DeviceRowProps) {
  const iconComp = deviceIcon(device);
  const actions = actionsFor(device);
  const meta = categoryMeta(device.category, device.type);

  // Pro Device: zeigen wir den letzten Feedback-Status der primary action.
  const primaryFb = feedback?.id === `${device.id}:${actions?.primary.key}` ? feedback : null;
  const primaryLoading = loading === `${device.id}:${actions?.primary.key}`;
  const iconSize = actions?.primary.large ? "size-5" : "size-4";

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center gap-3">
        {/* Icon */}
        <IconChip icon={iconComp} tone={meta.tone} />

        {/* Name */}
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold text-foreground truncate leading-tight"
            title={device.via === "direct" ? `${device.name} · Direktzugang` : `${device.name} · via Bereich`}
          >
            {device.name}
          </p>
        </div>

        {actions === null && (
          <span className="text-xs text-muted-foreground italic shrink-0 pr-1">—</span>
        )}
      </div>

      {/* Actions */}
      {actions !== null && (
        <div className="flex items-center gap-2">
          {actions.secondary?.map((action) => (
            <Button
              key={action.key}
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => onAction(device, action.key)}
              disabled={!enabled || loading !== null}
              aria-label={action.label}
              title={action.label}
              className={cn(
                actions.primary.large ? "size-14" : "size-11",
                // Im Hellen ist der Glasrand weiß auf weißer Karte – eine dunkle
                // Haarlinie zeigt die Taste (wie die Auswahltasten im Info-Formular).
                action.tone === "danger"
                  ? "bg-destructive/10 text-destructive ring-destructive/25 hover:bg-destructive/15"
                  : "ring-border dark:ring-glass-border",
              )}
            >
              {loading === `${device.id}:${action.key}`
                ? <Loader2 className={cn(iconSize, "animate-spin")} />
                : createElement(action.icon, { className: iconSize })}
            </Button>
          ))}

          <Button
            type="button"
            variant={primaryFb?.type === "err" ? "destructive" : "default"}
            onClick={() => onAction(device, actions.primary.key)}
            disabled={!enabled || loading !== null}
            className={cn(
              "flex-1 min-w-0 font-semibold",
              actions.primary.large ? "h-14 text-base" : "h-11",
              // Erfolg: Fläche und Glow in Grün (der Glow der Primärtaste wäre Indigo).
              primaryFb?.type === "ok" &&
                "bg-success text-success-foreground shadow-[inset_0_1px_0_oklch(1_0_0/28%),0_8px_20px_-10px_var(--success)] hover:bg-success/90",
              // Fehler im Dunkeln: Rot ist dort hell und trägt dunkle Schrift
              // (wie die Zustandspille), Weiß darauf hätte nur 4:1.
              primaryFb?.type === "err" && "dark:bg-destructive dark:text-background",
            )}
          >
            {primaryLoading ? (
              <Loader2 className={cn(iconSize, "animate-spin")} />
            ) : primaryFb?.type === "ok" ? (
              <CheckCircle2 className={iconSize} />
            ) : primaryFb?.type === "err" ? (
              <XCircle className={iconSize} />
            ) : (
              createElement(actions.primary.icon, { className: iconSize })
            )}
            <span className="whitespace-nowrap">
              {primaryFb?.type === "ok" ? "OK" : primaryFb?.type === "err" ? "Fehler" : actions.primary.label}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── HeaderStatusDot ─────────────────────────────────────────────────────────

/**
 * Zugangsstatus als Pille auf dem Akzentkopf, voll in der Zustandsfarbe:
 * grün aktiv, gelb ausserhalb der Zeit, rot kein Zutritt. Im Dunkeln sind
 * die Zustandsfarben hell und tragen dunkle Schrift – auch Rot.
 */
function HeaderStatusDot({ kind, label }: { kind: "ok" | "warn" | "err"; label: string }) {
  const cls = kind === "ok"
    ? "bg-success text-success-foreground"
    : kind === "warn"
      ? "bg-warning text-warning-foreground"
      : "bg-destructive text-destructive-foreground dark:text-background";
  return (
    <div
      title={label}
      className={cn("inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset ring-primary-foreground/25 px-2.5 py-1 shrink-0", cls)}
    >
      <span className="relative flex h-1.5 w-1.5">
        {kind === "ok" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 bg-current" />}
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
      </span>
      <span className="text-[11px] font-semibold whitespace-nowrap max-w-[120px] truncate">{label}</span>
    </div>
  );
}
