"use client";

import { useEffect, useMemo, useState } from "react";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type Cam,
  type PtzAutoConfig,
  REOLINK_CAPS,
} from "@/lib/types";
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  Plus,
  Route,
  Target,
  Trash2,
  Waves,
  Wand2,
  Hourglass,
  Rabbit,
  Snail,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";

interface Props {
  cam: Cam;
  /** Cam ist nur editing-mäßig schon angelegt — Presets fetchen nur dann. */
  editing: boolean;
  value: PtzAutoConfig;
  onChange: (next: PtzAutoConfig) => void;
}

interface Preset {
  id: number;
  name: string;
}

interface PtzAutoStatus {
  mode: string;
  subState: string;
  lastAction: string;
  lastError: string | null;
  lastUpdate: number;
  lastTargetAt: number;
  lastTargetId: number | null;
  patrolIdx: number;
  fps: number;
  manualOverrideRemaining: number;
}

const WEEKDAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function PtzAutoSection({ cam, editing, value, onChange }: Props) {
  const caps = REOLINK_CAPS[cam.model];
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [status, setStatus] = useState<PtzAutoStatus | null>(null);

  // Crossing-Counter sperrt PTZ-Auto: Linie ist in Frame-Koordinaten.
  const crossingActive =
    cam.peopleCounter.enabled && cam.peopleCounter.mode === "crossing";

  useEffect(() => {
    if (!editing || !caps.ptz) return;
    let stopped = false;
    fetch(`/api/cams/${cam.id}/preset`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (stopped) return;
        if (j.error) setPresetsError(j.error);
        setPresets((j.presets ?? []) as Preset[]);
      })
      .catch((e) => {
        if (!stopped) setPresetsError((e as Error).message);
      });
    return () => {
      stopped = true;
    };
  }, [cam.id, editing, caps.ptz]);

  // Live-Status pollen
  useEffect(() => {
    if (!editing || value.mode === "off") return;
    let stopped = false;
    async function tick() {
      try {
        const r = await fetch(`/api/ptz-auto/status`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { ptz: Record<string, PtzAutoStatus> };
        if (stopped) return;
        setStatus(j.ptz[cam.id] ?? null);
      } catch {
        if (!stopped) setStatus(null);
      }
    }
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [cam.id, editing, value.mode]);

  const presetById = useMemo(() => {
    const m = new Map<number, Preset>();
    for (const p of presets) m.set(p.id, p);
    return m;
  }, [presets]);

  function patch(p: Partial<PtzAutoConfig>) {
    onChange({ ...value, ...p });
  }
  function patchPatrol(p: Partial<PtzAutoConfig["patrol"]>) {
    onChange({ ...value, patrol: { ...value.patrol, ...p } });
  }
  function patchFollow(p: Partial<PtzAutoConfig["follow"]>) {
    onChange({ ...value, follow: { ...value.follow, ...p } });
  }

  if (!caps.ptz) {
    return (
      <p className="text-xs text-foreground/50">
        {cam.model} hat keine PTZ-Funktion — Auto-Pilot nicht verfügbar.
      </p>
    );
  }

  if (crossingActive && value.mode !== "off") {
    return (
      <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-500/30">
        PTZ-Auto und Crossing-Counter schließen sich aus, weil sich beim Pannen
        die Linie verschiebt. Erst Crossing deaktivieren, dann Auto-Pilot
        einschalten.
      </div>
    );
  }

  const usesFollow = value.mode === "follow" || value.mode === "patrol+follow";
  const usesPatrol = value.mode === "patrol" || value.mode === "patrol+follow";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field
          label="Modus"
          hint="Patrol = Preset-Tour · Follow = Personen verfolgen · Combo = Patrol + Follow bei Bewegung"
        >
          <Select
            value={value.mode}
            onChange={(e) => patch({ mode: e.target.value as PtzAutoConfig["mode"] })}
            disabled={crossingActive}
          >
            <option value="off">aus</option>
            <option value="patrol">Patrol (Preset-Tour)</option>
            <option value="follow">Follow (Person/Auto verfolgen)</option>
            <option value="patrol+follow">Patrol + Follow (Combo)</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <StatusBadge status={status} mode={value.mode} />
        </div>
      </div>

      {value.mode !== "off" && presetsError && (
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-500/30">
          Presets konnten nicht geladen werden: {presetsError} — speichere
          erst die Cam, dann lege Presets im Live-Modus an (Tasten Q/W/E/R im
          Fokus).
        </div>
      )}

      {usesPatrol && (
        <div className="rounded-lg bg-tile-accent p-3 ring-1 ring-border">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Route className="size-4" />
            Patrol-Tour
          </div>
          <PresetPicker
            presets={presets}
            selected={value.patrol.presetIds}
            onChange={(presetIds) => patchPatrol({ presetIds })}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="Standzeit pro Preset (Sekunden)" hint="2 – 3600">
              <Input
                type="number"
                min={2}
                max={3600}
                value={value.patrol.dwellSec}
                onChange={(e) =>
                  patchPatrol({ dwellSec: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Zeitfenster" hint="leer = immer aktiv">
              <ScheduleEditor
                value={value.patrol.schedule}
                onChange={(schedule) => patchPatrol({ schedule })}
              />
            </Field>
          </div>
        </div>
      )}

      {usesFollow && (
        <div className="rounded-lg bg-tile-accent p-3 ring-1 ring-border">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Target className="size-4" />
            Follow-Logik
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Ziel-Klasse">
              <Select
                value={value.follow.targetClass}
                onChange={(e) =>
                  patchFollow({
                    targetClass: e.target.value as
                      | "person"
                      | "car"
                      | "any",
                  })
                }
              >
                <option value="person">Person</option>
                <option value="car">Auto / Fahrzeug</option>
                <option value="any">Alles (Person + Auto + Tier)</option>
              </Select>
            </Field>
            <Field
              label="Steuerung"
              hint="Continuous = Reolink fährt durchgehend (glatt). Pulse = Stoß/Stop (legacy)."
            >
              <Select
                value={value.follow.controlMode}
                onChange={(e) =>
                  patchFollow({
                    controlMode: e.target.value as "continuous" | "pulse",
                  })
                }
              >
                <option value="continuous">Continuous (smooth)</option>
                <option value="pulse">Pulse (legacy, ruckelig)</option>
              </Select>
            </Field>
            <Field label="Heimkehr nach (Sekunden)" hint="ohne Target → Patrol/Home">
              <Input
                type="number"
                min={2}
                max={600}
                value={value.follow.returnHomeAfterSec}
                onChange={(e) =>
                  patchFollow({ returnHomeAfterSec: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field
              label="Speed Min"
              hint="Reolink 1–64; Speed nahe Deadband (langsam, präzise)"
            >
              <Input
                type="number"
                min={1}
                max={64}
                value={value.follow.speedMin}
                onChange={(e) =>
                  patchFollow({ speedMin: Number(e.target.value) })
                }
              />
            </Field>
            <Field
              label="Speed Max"
              hint="Speed bei großem Offset (schnell, eilen zurück zur Mitte)"
            >
              <Input
                type="number"
                min={1}
                max={64}
                value={value.follow.speedMax}
                onChange={(e) =>
                  patchFollow({ speedMax: Number(e.target.value) })
                }
              />
            </Field>
            {value.mode === "follow" && (
              <Field label="Heim-Preset (optional)">
                <Select
                  value={
                    value.follow.homePresetId === null
                      ? ""
                      : String(value.follow.homePresetId)
                  }
                  onChange={(e) =>
                    patchFollow({
                      homePresetId:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">— kein Heim-Preset —</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.id} {p.name || ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <AdvancedFollow value={value} onChange={patchFollow} />
          {caps.zoom === "optical" && (
            <div className="mt-3 rounded-md bg-tile p-3 ring-1 ring-border">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Auto-Zoom</div>
                  <div className="text-xs text-foreground/50">
                    Hält das Target auf einer Ziel-Höhe (Anteil Frame).
                  </div>
                </div>
                <Switch
                  checked={value.follow.zoomEnabled}
                  onChange={(v) => patchFollow({ zoomEnabled: v })}
                />
              </div>
              {value.follow.zoomEnabled && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label="Ziel-Größe (% der Frame-Höhe)">
                    <Input
                      type="number"
                      min={10}
                      max={90}
                      value={Math.round(value.follow.zoomTargetRatio * 100)}
                      onChange={(e) =>
                        patchFollow({
                          zoomTargetRatio: Math.max(
                            0.1,
                            Math.min(0.9, Number(e.target.value) / 100),
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
          {caps.zoom !== "optical" && (
            <p className="mt-2 text-xs text-foreground/50">
              {cam.model} hat keinen optischen Zoom — Auto-Zoom deaktiviert
              (digitaler Zoom bringt beim Tracking nichts).
            </p>
          )}
        </div>
      )}

      {value.mode !== "off" && status && (
        <div className="rounded-lg bg-tile-accent p-3 text-xs ring-1 ring-border">
          <div className="mb-1 flex items-center gap-2 text-foreground/80">
            <Crosshair className="size-3" />
            <span className="font-medium">Live-Status</span>
            {status.subState !== "idle" && (
              <Badge variant="info">{status.subState}</Badge>
            )}
            {status.fps > 0 && (
              <span className="text-foreground/50">{status.fps.toFixed(1)} fps</span>
            )}
          </div>
          {status.lastAction && (
            <div className="text-foreground/60">
              Zuletzt: <span className="font-mono">{status.lastAction}</span>
              {status.lastTargetId !== null &&
                ` · Target #${status.lastTargetId}`}
            </div>
          )}
          {status.manualOverrideRemaining > 0 && (
            <div className="text-amber-300">
              User-Override aktiv – Auto-Pilot pausiert noch{" "}
              {status.manualOverrideRemaining.toFixed(0)}s
            </div>
          )}
          {status.lastError && (
            <div className="text-red-300">Fehler: {status.lastError}</div>
          )}
        </div>
      )}
    </div>
  );
}

function PresetPicker({
  presets,
  selected,
  onChange,
}: {
  presets: Preset[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  function add(presetId: number) {
    if (selected.includes(presetId)) return;
    onChange([...selected, presetId]);
  }
  function remove(idx: number) {
    onChange(selected.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= selected.length) return;
    const next = selected.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  if (presets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-foreground/20 px-3 py-3 text-center text-xs text-foreground/50">
        Diese Cam hat noch keine Presets. Im Dashboard die Cam fokussieren und
        per <kbd>Q/W/E/R</kbd> Positionen speichern (oder direkt im Reolink-
        Web-UI), dann hier neu öffnen.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-foreground/60">
        Reihenfolge der Stops (von oben nach unten):
      </div>
      {selected.length === 0 ? (
        <p className="rounded-lg border border-dashed border-foreground/20 px-3 py-3 text-center text-xs text-foreground/50">
          Noch nichts ausgewählt. Unten Preset hinzufügen.
        </p>
      ) : (
        <ul className="space-y-1">
          {selected.map((presetId, idx) => {
            const p = presets.find((x) => x.id === presetId);
            return (
              <li
                key={`${presetId}-${idx}`}
                className="flex items-center gap-2 rounded-md bg-tile px-2 py-1 text-sm ring-1 ring-border"
              >
                <span className="flex-1 truncate">
                  <span className="font-mono text-xs text-foreground/40">
                    {idx + 1}.
                  </span>{" "}
                  #{presetId}{" "}
                  <span className="text-foreground/60">{p?.name ?? "?"}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  title="Nach oben"
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => move(idx, 1)}
                  disabled={idx === selected.length - 1}
                  title="Nach unten"
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(idx)}
                  title="Entfernen"
                >
                  <Trash2 className="size-3 text-red-400" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-1 pt-1">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => add(p.id)}
            className="rounded-md bg-tile px-2 py-1 text-xs ring-1 ring-border hover:ring-focus"
          >
            <Plus className="mr-1 inline size-3" />#{p.id} {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

type Schedule = NonNullable<PtzAutoConfig["patrol"]["schedule"]>;

function ScheduleEditor({
  value,
  onChange,
}: {
  value: Schedule | undefined;
  onChange: (next: Schedule | undefined) => void;
}) {
  const v: Schedule = value ?? { weekdays: [] };
  const weekdays = v.weekdays;

  function toggleDay(d: number) {
    const next = weekdays.includes(d)
      ? weekdays.filter((x) => x !== d)
      : [...weekdays, d].sort();
    onChange({ ...v, weekdays: next });
  }
  function clear() {
    onChange(undefined);
  }

  const empty = weekdays.length === 0 && !v.from && !v.to;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {WEEKDAY_LABELS.map((label, day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            className={`rounded-md px-2 py-1 text-xs ring-1 ${
              weekdays.includes(day)
                ? "bg-focus text-black ring-focus"
                : "bg-tile ring-border text-foreground/60 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <Input
          type="time"
          value={v.from ?? ""}
          onChange={(e) => onChange({ ...v, from: e.target.value || undefined })}
        />
        <Input
          type="time"
          value={v.to ?? ""}
          onChange={(e) => onChange({ ...v, to: e.target.value || undefined })}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          title="Zeitfenster leeren"
          disabled={empty}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

/**
 * Diagnose-orientierte Schnell-Tune-Presets. Jeder Button beschreibt
 * ein beobachtetes Symptom und setzt direkt die Parameter, die dieses
 * Symptom typischerweise beheben. Werte sind die in der Doku empfohlenen
 * Defaults — wer feiner schrauben will, klickt darunter durch die
 * Einzelfelder.
 *
 * Wichtig: nur Felder anfassen, die zum Symptom gehören. Sonst überfährt
 * man dem User seine bisherigen manuellen Tunings.
 */
const TUNE_PRESETS: ReadonlyArray<{
  key: string;
  label: string;
  hint: string;
  Icon: typeof Waves;
  patch: Partial<PtzAutoConfig["follow"]>;
  /** Lesbare Beschreibung der gesetzten Werte für den Toast. */
  applied: string;
}> = [
  {
    key: "wackelt",
    label: "Cam zittert / wackelt",
    hint: "Mehr Glättung, größere Innen-Deadband",
    Icon: Waves,
    patch: { smoothingAlpha: 0.3, deadbandPct: 0.08 },
    applied: "α=0.30, Innen-Deadband 8 %",
  },
  {
    key: "traege",
    label: "Reagiert zu spät",
    hint: "Mehr Voraussicht, weniger Glättung",
    Icon: Hourglass,
    patch: { smoothingAlpha: 0.6, latencyCompMs: 400 },
    applied: "α=0.60, Latenz-Voraus 400 ms",
  },
  {
    key: "ueberschiesst",
    label: "Schießt übers Ziel",
    hint: "Weniger vorausschauen, langsamer",
    Icon: Wand2,
    patch: { latencyCompMs: 150, speedMax: 30 },
    applied: "Latenz-Voraus 150 ms, Speed-Max 30",
  },
  {
    key: "lahm",
    label: "Eilt zu langsam zurück",
    hint: "Schnelleres Top-Speed-Limit",
    Icon: Rabbit,
    patch: { speedMax: 50 },
    applied: "Speed-Max 50",
  },
];

function AdvancedFollow({
  value,
  onChange,
}: {
  value: PtzAutoConfig;
  onChange: (p: Partial<PtzAutoConfig["follow"]>) => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const f = value.follow;

  function applyPreset(preset: (typeof TUNE_PRESETS)[number]) {
    onChange(preset.patch);
    toast(
      `${preset.label}: ${preset.applied} — Speichern nicht vergessen`,
      "info",
    );
    // Sektion offen halten, damit User die Auswirkung in den Feldern sieht.
    setOpen(true);
  }

  return (
    <div className="mt-3 rounded-md bg-tile p-2 ring-1 ring-border">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-xs text-foreground/70 hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        Erweitert: Hysterese, Glättung, Latenz-Vorhersage
      </button>
      {open && (
        <>
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-foreground/60">
              <Snail className="size-3" />
              Quick-Tune nach Symptom
            </div>
            <p className="mb-2 text-[11px] leading-snug text-foreground/50">
              Beobachtest du eines dieser Symptome an der Cam? Knopf
              drücken — die passenden Felder unten werden gesetzt. Danach
              speichern und ein paar Minuten beobachten.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TUNE_PRESETS.map((p) => {
                const Icon = p.Icon;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="flex h-full flex-col items-start gap-1 rounded-md bg-tile-accent p-2 text-left text-xs ring-1 ring-border transition hover:ring-focus"
                    title={`Setzt: ${p.applied}`}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <Icon className="size-3.5 text-foreground/70" />
                      {p.label}
                    </span>
                    <span className="leading-snug text-foreground/50">
                      {p.hint}
                    </span>
                    <span className="font-mono text-[10px] text-foreground/40">
                      {p.applied}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="my-3 border-t border-border" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Innere Deadband (%)"
            hint="Sobald Target hier landet → Stop. Klein halten."
          >
            <Input
              type="number"
              min={1}
              max={40}
              value={Math.round(f.deadbandPct * 100)}
              onChange={(e) =>
                onChange({
                  deadbandPct: Math.max(
                    0.01,
                    Math.min(0.4, Number(e.target.value) / 100),
                  ),
                })
              }
            />
          </Field>
          <Field
            label="Äußere Deadband (%)"
            hint="Erst hier raus → wieder bewegen. Hysterese gegen Pumpen."
          >
            <Input
              type="number"
              min={2}
              max={50}
              value={Math.round(f.outerDeadbandPct * 100)}
              onChange={(e) =>
                onChange({
                  outerDeadbandPct: Math.max(
                    0.02,
                    Math.min(0.5, Number(e.target.value) / 100),
                  ),
                })
              }
            />
          </Field>
          <Field
            label="Glättung α"
            hint="0 = roh (zittert), 1 = unendlich träge. 0.4–0.5 ok"
          >
            <Input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={f.smoothingAlpha}
              onChange={(e) =>
                onChange({ smoothingAlpha: Number(e.target.value) })
              }
            />
          </Field>
          <Field
            label="Latenz-Voraus (ms)"
            hint="RTSP ~300 ms; Cam zielt um diese Zeit nach vorn"
          >
            <Input
              type="number"
              min={0}
              max={1000}
              value={f.latencyCompMs}
              onChange={(e) =>
                onChange({ latencyCompMs: Number(e.target.value) })
              }
            />
          </Field>
          {f.controlMode === "pulse" && (
            <Field
              label="Pulse-Länge (ms)"
              hint="nur im Pulse-Mode: Dauer pro Korrektur"
            >
              <Input
                type="number"
                min={50}
                max={800}
                value={f.maxPulseMs}
                onChange={(e) =>
                  onChange({ maxPulseMs: Number(e.target.value) })
                }
              />
            </Field>
          )}
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  mode,
}: {
  status: PtzAutoStatus | null;
  mode: PtzAutoConfig["mode"];
}) {
  if (mode === "off") return null;
  if (!status) return <Badge variant="default">Sidecar offline</Badge>;
  if (status.subState === "follow") return <Badge variant="success">verfolgt</Badge>;
  if (status.subState === "patrol") return <Badge variant="info">patroullie</Badge>;
  if (status.subState === "homing") return <Badge variant="info">fährt heim</Badge>;
  if (status.subState === "paused") return <Badge variant="warn">pausiert</Badge>;
  return <Badge variant="default">{status.subState}</Badge>;
}
