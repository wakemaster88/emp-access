"use client";

/** Aktionsliste einer Regel: Gerät schalten, benachrichtigen, Audio. */

import { ArrowDown, ArrowUp, Bell, Plus, Trash2, Volume2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  };
}

const selectClass =
  "h-8 w-full rounded-md border border-neutral-200 bg-transparent px-2 text-xs dark:border-neutral-800";

const KIND_ICONS: Record<RuleActionKind, React.ReactNode> = {
  DEVICE: <Zap className="h-3.5 w-3.5 text-amber-500" />,
  NOTIFY: <Bell className="h-3.5 w-3.5 text-sky-500" />,
  AUDIO: <Volume2 className="h-3.5 w-3.5 text-violet-500" />,
};

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
        <Label className="text-[11px] text-neutral-500">Gerät</Label>
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
        <Label className="text-[11px] text-neutral-500">Befehl</Label>
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
        <Label className="text-[11px] text-neutral-500">Selbstabschaltung</Label>
        <Input
          type="number"
          min={1}
          placeholder="Sek., optional"
          className="h-8 text-xs"
          disabled={disabled}
          value={action.timerSeconds ?? ""}
          onChange={(e) =>
            onChange({ ...action, timerSeconds: e.target.value ? Number(e.target.value) : null })
          }
        />
      </div>

      {device && controls.length === 0 && (
        <p className="text-[11px] text-amber-600 sm:col-span-3">
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
        <Label className="text-[11px] text-neutral-500">Kanal</Label>
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
        <Label className="text-[11px] text-neutral-500">Text</Label>
        <Input
          className="h-8 text-xs"
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
        <Label className="text-[11px] text-neutral-500">Zone</Label>
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
        <Label className="text-[11px] text-neutral-500">Was</Label>
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
        <Label className="text-[11px] text-neutral-500">
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
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          Ohne Aktion passiert beim Auslösen nichts.
        </p>
      )}

      {actions.map((action, index) => (
        <div
          key={index}
          className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {KIND_ICONS[action.kind]}
              <span className="text-neutral-500">{index + 1}.</span>
              <select
                className="h-7 rounded-md border border-neutral-200 bg-transparent px-1.5 text-xs dark:border-neutral-800"
                disabled={disabled}
                value={action.kind}
                onChange={(e) => update(index, emptyAction(e.target.value as RuleActionKind))}
              >
                <option value="DEVICE">Gerät schalten</option>
                <option value="NOTIFY">Benachrichtigen</option>
                <option value="AUDIO">Audio</option>
              </select>
            </div>
            <div className="flex gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-neutral-400"
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
                title="Nach oben"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-neutral-400"
                disabled={disabled || index === actions.length - 1}
                onClick={() => move(index, 1)}
                title="Nach unten"
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-neutral-400 hover:text-red-600"
                disabled={disabled}
                onClick={() => onChange(actions.filter((_, i) => i !== index))}
                title="Entfernen"
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
          className="h-8 text-xs"
          disabled={disabled}
          onClick={() => onChange([...actions, emptyAction("DEVICE")])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Gerät
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={disabled}
          onClick={() => onChange([...actions, emptyAction("NOTIFY")])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Nachricht
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={disabled || options.audioZones.length === 0}
          onClick={() => onChange([...actions, emptyAction("AUDIO")])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Audio
        </Button>
      </div>

      {actions.length > 1 && (
        <p className="text-[11px] text-neutral-500">
          Die Aktionen laufen der Reihe nach. Schlägt eine fehl, laufen die übrigen trotzdem.
        </p>
      )}
    </div>
  );
}
