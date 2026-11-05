"use client";

/** Aktionsliste einer Regel: Gerät schalten, benachrichtigen, Audio, Kamera. */

import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Bell, Cctv, Loader2, Plus, Trash2, Volume2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { deviceControls } from "@/lib/device-controls";
import { deviceMetaLabel } from "@/components/raeume/shared";
import type { RuleActionKind, RuleOptions } from "@/components/regeln/types";

/** Aktion im Bearbeitungszustand – ohne ID, weil beim Speichern ersetzt wird. */
export interface ActionDraft {
  kind: RuleActionKind;
  deviceId: number | null;
  deviceAction: string | null;
  timerSeconds: number | null;
  channel: "TELEGRAM" | "PUSH" | "BOTH";
  message: string;
  audioZoneId: number | null;
  audioAnnouncementId: number | null;
  audioPlaylistId: number | null;
  /**
   * Nur für die Bedienung: "Stopp" hat keine ID, an der man es erkennen
   * könnte, und beim Wechsel zwischen Durchsage und Playlist soll die Auswahl
   * nicht auf "Stopp" zurückfallen.
   */
  audioMode: "announcement" | "playlist" | "stop";
  /** CAMERA: Kamera, Preset, folgen (null = unverändert), zurück nach Sek. */
  targetCameraId: number | null;
  ptzPresetId: number | null;
  autoTrack: boolean | null;
  returnAfterSeconds: number | null;
}

export function emptyAction(kind: RuleActionKind): ActionDraft {
  return {
    kind,
    deviceId: null,
    deviceAction: null,
    timerSeconds: null,
    channel: "PUSH",
    message: "",
    audioZoneId: null,
    audioAnnouncementId: null,
    audioPlaylistId: null,
    audioMode: "announcement",
    targetCameraId: null,
    ptzPresetId: null,
    autoTrack: kind === "CAMERA" ? true : null,
    returnAfterSeconds: null,
  };
}

// Eigene Auswahlfelder wie Eingabefelder: glass-field, 16 px Schrift auf dem Handy (Abschnitt 16).
const fieldClass =
  "glass-field h-9 px-2 text-base text-foreground outline-none transition-[color,box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50 max-sm:h-11 md:text-sm";
const selectClass = `w-full ${fieldClass}`;

// Die Art der Aktion ist kein Zustand: Symbole gedämpft statt Zustandsfarben.
const KIND_ICONS: Record<RuleActionKind, React.ReactNode> = {
  DEVICE: <Zap className="h-3.5 w-3.5 text-muted-foreground" />,
  NOTIFY: <Bell className="h-3.5 w-3.5 text-muted-foreground" />,
  AUDIO: <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />,
  CAMERA: <Cctv className="h-3.5 w-3.5 text-muted-foreground" />,
};

/**
 * Kamera steuern: Preset anfahren und „automatisch folgen“ schalten. Presets
 * fragt der Hub live bei der Kamera ab; ohne Hub geht die Nummer von Hand.
 */
function CameraFields({
  action,
  options,
  disabled,
  onChange,
}: {
  action: ActionDraft;
  options: RuleOptions;
  disabled?: boolean;
  onChange: (next: ActionDraft) => void;
}) {
  const [presets, setPresets] = useState<Array<{ id: number; name: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPresets(cameraId: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cameras/${cameraId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "presets" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        result?: { presets?: Array<{ id: number; name: string }> };
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setPresets(body.result?.presets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPresets(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="space-y-1">
        <Label>Kamera</Label>
        <select
          className={selectClass}
          disabled={disabled}
          value={action.targetCameraId ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            setPresets(null);
            setError(null);
            onChange({ ...action, targetCameraId: id, ptzPresetId: null });
            if (id) void loadPresets(id);
          }}
        >
          <option value="">— Kamera wählen —</option>
          {options.cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label>Position (Preset)</Label>
        {presets && presets.length > 0 ? (
          <select
            className={selectClass}
            disabled={disabled}
            value={action.ptzPresetId ?? ""}
            onChange={(e) =>
              onChange({ ...action, ptzPresetId: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">— nicht bewegen —</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (#{p.id})
              </option>
            ))}
          </select>
        ) : (
          <div className="flex gap-1">
            <Input
              type="number"
              min={0}
              placeholder="Nr., optional"
              disabled={disabled}
              value={action.ptzPresetId ?? ""}
              onChange={(e) =>
                onChange({ ...action, ptzPresetId: e.target.value ? Number(e.target.value) : null })
              }
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 px-3"
              disabled={disabled || loading || !action.targetCameraId}
              onClick={() => action.targetCameraId && void loadPresets(action.targetCameraId)}
            >
              {loading ? "…" : "Laden"}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label>Automatisch folgen</Label>
        <select
          className={selectClass}
          disabled={disabled}
          value={action.autoTrack == null ? "" : action.autoTrack ? "on" : "off"}
          onChange={(e) =>
            onChange({
              ...action,
              autoTrack: e.target.value === "" ? null : e.target.value === "on",
            })
          }
        >
          <option value="on">an</option>
          <option value="off">aus</option>
          <option value="">unverändert</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label>Danach zurück</Label>
        <Input
          type="number"
          min={5}
          max={3600}
          placeholder="Sek., optional"
          disabled={disabled}
          value={action.returnAfterSeconds ?? ""}
          onChange={(e) =>
            onChange({
              ...action,
              returnAfterSeconds: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </div>

      <p className="text-[11px] text-muted-foreground sm:col-span-2 sm:self-end">
        Die Kamera fährt die Position an und folgt danach Personen bzw. Fahrzeugen. Mit
        „Danach zurück“ geht sie nach der Zeit wieder auf die Position, Folgen wie vorher.
      </p>
      {loading && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground sm:col-span-3">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          Presets werden vom Hub geladen …
        </p>
      )}
      {/* Hinweise in ruhiger Schrift, die Warnfarbe trägt nur das Symbol (Kontrast). */}
      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground sm:col-span-3">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
          Presets nicht geladen ({error}). Nummer von Hand eintragen.
        </p>
      )}
      {presets && presets.length === 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground sm:col-span-3">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
          Diese Kamera hat keine Presets. Im Kamera-Kontrollzentrum eine Position speichern.
        </p>
      )}
    </div>
  );
}

function DeviceFields({
  action,
  options,
  disabled,
  onChange,
}: {
  action: ActionDraft;
  options: RuleOptions;
  disabled?: boolean;
  onChange: (next: ActionDraft) => void;
}) {
  const device = options.devices.find((d) => d.id === action.deviceId) ?? null;
  const controls = device ? deviceControls(device) : [];

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="space-y-1 sm:col-span-2">
        <Label>Gerät</Label>
        <select
          className={selectClass}
          disabled={disabled}
          value={action.deviceId ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            const next = options.devices.find((d) => d.id === id);
            // Der bisherige Schaltbefehl passt selten zum neuen Gerät, deshalb
            // gleich den Hauptbefehl des neuen Geräts vorbelegen.
            onChange({
              ...action,
              deviceId: id,
              deviceAction: next ? (deviceControls(next)[0]?.action ?? null) : null,
            });
          }}
        >
          <option value="">— Gerät wählen —</option>
          {options.devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({deviceMetaLabel(d.type, d.category)})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label>Befehl</Label>
        <select
          className={selectClass}
          disabled={disabled || !device}
          value={action.deviceAction ?? ""}
          onChange={(e) => onChange({ ...action, deviceAction: e.target.value || null })}
        >
          <option value="">— wählen —</option>
          {controls.map((c) => (
            <option key={c.action} value={c.action}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label>Selbstabschaltung</Label>
        <Input
          type="number"
          min={1}
          placeholder="Sek., optional"
          disabled={disabled}
          value={action.timerSeconds ?? ""}
          onChange={(e) =>
            onChange({ ...action, timerSeconds: e.target.value ? Number(e.target.value) : null })
          }
        />
      </div>

      {device && controls.length === 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground sm:col-span-3">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
          Dieses Gerät lässt sich nicht schalten (Sensor).
        </p>
      )}
    </div>
  );
}

function NotifyFields({
  action,
  disabled,
  onChange,
}: {
  action: ActionDraft;
  disabled?: boolean;
  onChange: (next: ActionDraft) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="space-y-1">
        <Label>Kanal</Label>
        <select
          className={selectClass}
          disabled={disabled}
          value={action.channel}
          onChange={(e) => onChange({ ...action, channel: e.target.value as ActionDraft["channel"] })}
        >
          <option value="PUSH">Push</option>
          <option value="TELEGRAM">Telegram</option>
          <option value="BOTH">Telegram und Push</option>
        </select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>Text</Label>
        <Input
          placeholder="leer = Name der Regel"
          disabled={disabled}
          value={action.message}
          onChange={(e) => onChange({ ...action, message: e.target.value })}
        />
      </div>
    </div>
  );
}

function AudioFields({
  action,
  options,
  disabled,
  onChange,
}: {
  action: ActionDraft;
  options: RuleOptions;
  disabled?: boolean;
  onChange: (next: ActionDraft) => void;
}) {
  // Durchsage oder Playlist, nie beides: der Zonen-Pi kann nur eines
  // abspielen, und "beides" hätte keine klare Bedeutung.
  const mode = action.audioMode;

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="space-y-1">
        <Label>Zone</Label>
        <select
          className={selectClass}
          disabled={disabled}
          value={action.audioZoneId ?? ""}
          onChange={(e) =>
            onChange({ ...action, audioZoneId: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">— Zone wählen —</option>
          {options.audioZones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label>Was</Label>
        <select
          className={selectClass}
          disabled={disabled}
          value={mode}
          onChange={(e) =>
            onChange({
              ...action,
              audioMode: e.target.value as ActionDraft["audioMode"],
              audioAnnouncementId: null,
              audioPlaylistId: null,
            })
          }
        >
          <option value="announcement">Durchsage</option>
          <option value="playlist">Playlist</option>
          <option value="stop">Wiedergabe stoppen</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label>
          {mode === "playlist" ? "Playlist" : "Durchsage"}
        </Label>
        <select
          className={selectClass}
          disabled={disabled || mode === "stop"}
          value={(mode === "playlist" ? action.audioPlaylistId : action.audioAnnouncementId) ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onChange(
              mode === "playlist"
                ? { ...action, audioPlaylistId: id, audioAnnouncementId: null }
                : { ...action, audioAnnouncementId: id, audioPlaylistId: null },
            );
          }}
        >
          <option value="">— wählen —</option>
          {(mode === "playlist" ? options.playlists : options.announcements).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ActionEditor({
  actions,
  options,
  disabled,
  onChange,
}: {
  actions: ActionDraft[];
  options: RuleOptions;
  disabled?: boolean;
  onChange: (next: ActionDraft[]) => void;
}) {
  function update(index: number, next: ActionDraft) {
    onChange(actions.map((a, i) => (i === index ? next : a)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= actions.length) return;
    const next = [...actions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {actions.length === 0 && (
        <Notice tone="warning" compact title="Ohne Aktion passiert beim Auslösen nichts." />
      )}

      {actions.map((action, index) => (
        // Gruppe im Dialog als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (Abschnitt 18).
        <div
          key={index}
          className="glass-tile p-3"
        >
          {/* Handy: Nummer und Tasten in einer Zeile, die Art darunter in voller Breite wie die übrigen Felder. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs font-medium">
            {KIND_ICONS[action.kind]}
            <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
            <select
              className={`${fieldClass} max-sm:order-last max-sm:w-full`}
              disabled={disabled}
              value={action.kind}
              onChange={(e) => update(index, emptyAction(e.target.value as RuleActionKind))}
            >
              <option value="DEVICE">Gerät schalten</option>
              <option value="NOTIFY">Benachrichtigen</option>
              <option value="AUDIO">Audio</option>
              <option value="CAMERA">Kamera steuern</option>
            </select>
            <div className="ml-auto flex gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground max-sm:size-11"
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
                title="Nach oben"
                aria-label="Nach oben"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground max-sm:size-11"
                disabled={disabled || index === actions.length - 1}
                onClick={() => move(index, 1)}
                title="Nach unten"
                aria-label="Nach unten"
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive max-sm:size-11"
                disabled={disabled}
                onClick={() => onChange(actions.filter((_, i) => i !== index))}
                title="Entfernen"
                aria-label="Entfernen"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {action.kind === "DEVICE" && (
            <DeviceFields
              action={action}
              options={options}
              disabled={disabled}
              onChange={(next) => update(index, next)}
            />
          )}
          {action.kind === "NOTIFY" && (
            <NotifyFields
              action={action}
              disabled={disabled}
              onChange={(next) => update(index, next)}
            />
          )}
          {action.kind === "CAMERA" && (
            <CameraFields
              action={action}
              options={options}
              disabled={disabled}
              onChange={(next) => update(index, next)}
            />
          )}
          {action.kind === "AUDIO" && (
            <AudioFields
              action={action}
              options={options}
              disabled={disabled}
              onChange={(next) => update(index, next)}
            />
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...actions, emptyAction("DEVICE")])}
        >
          <Plus className="h-3.5 w-3.5" />
          Gerät
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...actions, emptyAction("NOTIFY")])}
        >
          <Plus className="h-3.5 w-3.5" />
          Nachricht
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || options.audioZones.length === 0}
          onClick={() => onChange([...actions, emptyAction("AUDIO")])}
        >
          <Plus className="h-3.5 w-3.5" />
          Audio
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || options.cameras.length === 0}
          onClick={() => onChange([...actions, emptyAction("CAMERA")])}
        >
          <Plus className="h-3.5 w-3.5" />
          Kamera
        </Button>
      </div>

      {actions.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Die Aktionen laufen der Reihe nach. Schlägt eine fehl, laufen die übrigen trotzdem.
        </p>
      )}
    </div>
  );
}
