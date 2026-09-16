"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  Bookmark,
  Check,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatControlValue,
  formatGainDb,
  formatNode,
  gainRawToDb,
  rawToPercent,
} from "@/lib/soundweb";
import { Chip, sliderFill } from "./ui";
import { formatRelativeTime } from "./labels";
import { SoundwebControlDialog } from "./soundweb-control-dialog";
import { SoundwebDeviceDialog } from "./soundweb-device-dialog";
import { useSoundwebStatus } from "./use-soundweb-status";
import type { SoundwebControlRow, SoundwebDeviceRow } from "./types";

interface Props {
  devices: SoundwebDeviceRow[];
  /** Meldet sich der lokale Hub? Ohne ihn kommt kein Befehl an. */
  hubOnline: boolean;
  /** Tab sichtbar – nur dann laufen die Statusabfragen. */
  active: boolean;
  /** Nach Anlegen, Ändern, Löschen: Seite neu laden. */
  onChanged: () => void;
}

/** Bestätigte Werte aus Befehlen, bis die Statusabfrage sie eingeholt hat. */
type KnownValues = Map<number, number>;

/**
 * Soundweb-Karte: alle Prozessoren mit den Reglern, die im Alltag gebraucht
 * werden. Was hier steht, hat jemand bewusst aus dem Audio-Architect-Design
 * ausgesucht – die Karte ist die Bedienoberfläche, nicht der Editor.
 */
export function SoundwebPanel({ devices, hubOnline: hubOnlineInitial, active, onChanged }: Props) {
  const status = useSoundwebStatus(active);
  const hubOnline = status.hubOnline ?? hubOnlineInitial;

  const [deviceDialog, setDeviceDialog] = useState<{ open: boolean; device: SoundwebDeviceRow | null }>({
    open: false,
    device: null,
  });
  const [controlDialog, setControlDialog] = useState<{
    open: boolean;
    device: SoundwebDeviceRow;
    control: SoundwebControlRow | null;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    { kind: "device" | "control"; id: number; name: string } | null
  >(null);

  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [known, setKnown] = useState<KnownValues>(new Map());
  const [recalled, setRecalled] = useState<number | null>(null);

  // Ein bestätigter Wert gilt, bis die Statusabfrage denselben Stand liefert –
  // sonst spränge der Regler nach dem Loslassen kurz auf den alten zurück.
  useEffect(() => {
    if (known.size === 0) return;
    let changed = false;
    const next = new Map(known);
    for (const [id, value] of known) {
      if (status.controls.get(id)?.value === value) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) setKnown(next);
  }, [status.controls, known]);

  useEffect(() => {
    if (recalled === null) return;
    const timer = setTimeout(() => setRecalled(null), 2500);
    return () => clearTimeout(timer);
  }, [recalled]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices) for (const c of d.controls) if (c.group) set.add(c.group);
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }, [devices]);

  function liveValue(control: SoundwebControlRow): number | null {
    const confirmed = known.get(control.id);
    if (confirmed !== undefined) return confirmed;
    const live = status.controls.get(control.id);
    return live ? live.value : control.value;
  }

  function setBusyFor(id: number, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function send(control: SoundwebControlRow, value: unknown) {
    setBusyFor(control.id, true);
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(control.id);
      return next;
    });
    try {
      const res = await fetch(`/api/audio/soundweb/controls/${control.id}/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; value?: number | null };
      if (!res.ok) {
        setErrors((prev) => new Map(prev).set(control.id, data.error ?? "Befehl fehlgeschlagen"));
        return;
      }
      if (control.kind === "PRESET") setRecalled(control.id);
      else if (typeof data.value === "number") {
        setKnown((prev) => new Map(prev).set(control.id, data.value as number));
      }
      void status.refresh();
    } catch {
      setErrors((prev) => new Map(prev).set(control.id, "Keine Verbindung zum Server"));
    } finally {
      setBusyFor(control.id, false);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const path =
      deleteConfirm.kind === "device"
        ? `/api/audio/soundweb/${deleteConfirm.id}`
        : `/api/audio/soundweb/controls/${deleteConfirm.id}`;
    await fetch(path, { method: "DELETE" });
    setDeleteConfirm(null);
    onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          BSS Soundweb London: Pegel, Stummschaltungen und Presets aus dem Audio-Architect-Design
          – der lokale Hub hält die Verbindung.
        </p>
        <Button
          onClick={() => setDeviceDialog({ open: true, device: null })}
          className="w-full gap-1.5 sm:w-auto sm:shrink-0"
        >
          <Plus className="h-4 w-4" /> Soundweb hinzufügen
        </Button>
      </div>

      {!hubOnline && devices.length > 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Der lokale Hub meldet sich nicht. Die Soundwebs hängen am Netz des Hubs – ohne
          ihn kommt kein Befehl an und die Werte hier sind der letzte bekannte Stand.
        </p>
      )}

      {devices.length === 0 ? (
        <Card className="border-dashed border-input">
          <CardContent className="py-10 text-center">
            <SlidersHorizontal className="mx-auto mb-3 h-10 w-10 text-muted-foreground/70" />
            <h3 className="font-semibold text-foreground/80">Noch kein Soundweb</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Lege den Prozessor mit IP-Adresse und HiQnet-Node an und wähle danach die Regler
              aus dem Design, die hier bedient werden sollen.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              live={status.devices.get(device.id)}
              hubOnline={hubOnline}
              valueOf={liveValue}
              busy={busy}
              errors={errors}
              recalled={recalled}
              onSend={send}
              onEdit={() => setDeviceDialog({ open: true, device })}
              onDelete={() => setDeleteConfirm({ kind: "device", id: device.id, name: device.name })}
              onAddControl={() => setControlDialog({ open: true, device, control: null })}
              onEditControl={(control) => setControlDialog({ open: true, device, control })}
              onDeleteControl={(control) =>
                setDeleteConfirm({ kind: "control", id: control.id, name: control.name })
              }
            />
          ))}
        </div>
      )}

      {deviceDialog.open && (
        <SoundwebDeviceDialog
          open
          device={deviceDialog.device}
          onClose={() => setDeviceDialog({ open: false, device: null })}
          onSaved={() => {
            setDeviceDialog({ open: false, device: null });
            onChanged();
          }}
        />
      )}

      {controlDialog?.open && (
        <SoundwebControlDialog
          open
          device={controlDialog.device}
          control={controlDialog.control}
          groups={groups}
          onClose={() => setControlDialog(null)}
          onSaved={() => {
            setControlDialog(null);
            onChanged();
          }}
        />
      )}

      <AlertDialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{deleteConfirm?.name}&ldquo; löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm?.kind === "device"
                ? "Der Prozessor und alle seine Regler verschwinden aus dem Dashboard. Am Gerät selbst ändert sich nichts."
                : "Der Regler verschwindet aus dem Dashboard. Am Gerät selbst ändert sich nichts."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Gerätekarte
 * ------------------------------------------------------------------------- */

interface DeviceCardProps {
  device: SoundwebDeviceRow;
  live: { online: boolean; connected: boolean; lastSeenAt: string | null; lastError: string | null } | undefined;
  hubOnline: boolean;
  valueOf: (control: SoundwebControlRow) => number | null;
  busy: Set<number>;
  errors: Map<number, string>;
  recalled: number | null;
  onSend: (control: SoundwebControlRow, value: unknown) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddControl: () => void;
  onEditControl: (control: SoundwebControlRow) => void;
  onDeleteControl: (control: SoundwebControlRow) => void;
}

function DeviceCard({
  device,
  live,
  hubOnline,
  valueOf,
  busy,
  errors,
  recalled,
  onSend,
  onEdit,
  onDelete,
  onAddControl,
  onEditControl,
  onDeleteControl,
}: DeviceCardProps) {
  const online = live ? live.online : device.online;
  const lastError = live ? live.lastError : device.lastError;
  const lastSeenAt = live ? live.lastSeenAt : device.lastSeenAt;
  // Befehle sind nur sinnvoll, wenn Hub und Verbindung stehen.
  const usable = hubOnline && online && device.isActive;

  const sections = useMemo(() => {
    const map = new Map<string | null, SoundwebControlRow[]>();
    for (const control of device.controls) {
      const list = map.get(control.group) ?? [];
      list.push(control);
      map.set(control.group, list);
    }
    // Ohne Abschnitt zuerst, dann alphabetisch.
    return [...map.entries()].sort((a, b) => {
      if (a[0] === null) return -1;
      if (b[0] === null) return 1;
      return a[0].localeCompare(b[0], "de");
    });
  }, [device.controls]);

  let stateLabel: React.ReactNode;
  if (!device.isActive) {
    stateLabel = <Badge variant="secondary">Deaktiviert</Badge>;
  } else if (!hubOnline) {
    stateLabel = (
      <span className="flex items-center gap-1.5 text-xs text-warning">
        <StatusDot tone="warning" /> Hub offline
      </span>
    );
  } else if (online) {
    stateLabel = (
      <span className="flex items-center gap-1.5 text-xs text-success">
        <StatusDot tone="success" pulse /> Verbunden
      </span>
    );
  } else if (lastSeenAt) {
    stateLabel = (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <StatusDot tone="danger" /> Getrennt
      </span>
    );
  } else {
    stateLabel = (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot tone="neutral" /> Noch keine Meldung vom Hub
      </span>
    );
  }

  return (
    <Card className={cn(!device.isActive && "opacity-70")}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{device.name}</h3>
            <p className="text-xs text-muted-foreground">
              {device.host}:{device.port} · Node {formatNode(device.node)}
              {device.hubName ? ` · ${device.hubName}` : ""}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {stateLabel}
              {lastSeenAt && (
                <span className="text-xs text-muted-foreground">
                  · gemeldet {formatRelativeTime(lastSeenAt) ?? "gerade eben"}
                </span>
              )}
            </div>
            {device.isActive && hubOnline && !online && lastError && (
              <p className="mt-1 text-xs text-destructive">{lastError}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" onClick={onAddControl} className="h-10 gap-1.5 text-xs sm:h-8">
              <Plus className="h-3.5 w-3.5" /> Regler
            </Button>
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`${device.name} bearbeiten`} className="sm:size-8">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              aria-label={`${device.name} löschen`}
              className="text-muted-foreground hover:text-destructive sm:size-8"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {device.controls.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground">
            Noch kein Regler. „Regler“ öffnet den Dialog – dort die HiQnet-Adresse des Objekts aus
            Audio Architect eintragen.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {sections.map(([group, controls]) => (
              <div key={group ?? "__none__"}>
                {group && (
                  <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group}
                  </h4>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {controls.map((control) => (
                    <ControlTile
                      key={control.id}
                      control={control}
                      value={valueOf(control)}
                      disabled={!usable}
                      busy={busy.has(control.id)}
                      error={errors.get(control.id) ?? null}
                      recalled={recalled === control.id}
                      onSend={(value) => onSend(control, value)}
                      onEdit={() => onEditControl(control)}
                      onDelete={() => onDeleteControl(control)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * Ein Regler
 * ------------------------------------------------------------------------- */

interface ControlTileProps {
  control: SoundwebControlRow;
  /** Rohwert der State Variable, null = noch nicht gemeldet. */
  value: number | null;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  recalled: boolean;
  onSend: (value: unknown) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ControlTile({ control, value, disabled, busy, error, recalled, onSend, onEdit, onDelete }: ControlTileProps) {
  return (
    <div className="rounded-lg border border-input p-3 dark:border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{control.name}</p>
          {control.kind !== "PRESET" && control.kind !== "GAIN" && control.kind !== "PERCENT" && (
            <p className="text-xs text-muted-foreground">
              {formatControlValue(control, value) ?? "noch kein Wert"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={`${control.name} bearbeiten`}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            aria-label={`${control.name} löschen`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="mt-2">
        {control.kind === "GAIN" && (
          <GainSlider control={control} raw={value} disabled={disabled} onCommit={onSend} />
        )}
        {control.kind === "PERCENT" && (
          <PercentSlider control={control} raw={value} disabled={disabled} onCommit={onSend} />
        )}
        {control.kind === "MUTE" && (
          <MuteButton muted={value !== null && value !== 0} unknown={value === null} disabled={disabled} onToggle={onSend} />
        )}
        {control.kind === "SELECT" && (
          <div className="flex flex-wrap gap-1.5">
            {control.options.map((option) => (
              <Chip
                key={option.value}
                active={value === option.value}
                disabled={disabled}
                onClick={() => onSend(option.value)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        )}
        {control.kind === "PRESET" && (
          <Button
            variant={recalled ? "default" : "outline"}
            disabled={disabled || busy}
            onClick={() => onSend(undefined)}
            className="h-10 w-full gap-1.5 sm:h-9"
          >
            {recalled ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            {recalled ? "Abgerufen" : `Preset ${control.presetId ?? "?"} abrufen`}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Verzögerung, bis eine Reglerbewegung als abgeschlossen gilt. */
const COMMIT_MS = 300;

/**
 * Regler mit eigener Eingabe, die den Serverwert überstimmt, bis er bestätigt
 * ist – dieselbe Mechanik wie der Lautstärkeregler der Zonen. Der Vergleich
 * hat eine Toleranz, weil der Prozessor auf sein Raster rundet.
 */
function useCommittedNumber(serverValue: number, epsilon: number, onCommit: (value: number) => void) {
  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (pending !== null && Math.abs(pending - serverValue) <= epsilon) setPending(null);

  function change(next: number) {
    setPending(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next), COMMIT_MS);
  }

  return { value: pending ?? serverValue, change, pending: pending !== null };
}

function GainSlider({
  control,
  raw,
  disabled,
  onCommit,
}: {
  control: SoundwebControlRow;
  raw: number | null;
  disabled: boolean;
  onCommit: (db: number) => void;
}) {
  const serverDb = raw === null ? control.minDb : Math.min(control.maxDb, Math.max(control.minDb, gainRawToDb(raw)));
  const slider = useCommittedNumber(serverDb, 0.26, onCommit);
  const percent = ((slider.value - control.minDb) / (control.maxDb - control.minDb)) * 100;

  return (
    <div className="flex items-center gap-2">
      <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground/70" />
      <input
        type="range"
        min={control.minDb}
        max={control.maxDb}
        step={0.5}
        value={slider.value}
        disabled={disabled}
        onChange={(e) => slider.change(Number(e.target.value))}
        aria-label={`${control.name} in Dezibel`}
        aria-valuetext={formatGainDb(slider.value, control.minDb)}
        style={sliderFill(percent)}
        className="touch-slider flex-1"
      />
      <span className={cn("w-16 text-right text-xs tabular-nums", raw === null && !slider.pending ? "text-muted-foreground/60" : "text-muted-foreground")}>
        {raw === null && !slider.pending ? "–" : formatGainDb(slider.value, control.minDb)}
      </span>
    </div>
  );
}

function PercentSlider({
  control,
  raw,
  disabled,
  onCommit,
}: {
  control: SoundwebControlRow;
  raw: number | null;
  disabled: boolean;
  onCommit: (percent: number) => void;
}) {
  const serverPercent = raw === null ? 0 : Math.round(rawToPercent(raw));
  const slider = useCommittedNumber(serverPercent, 0.6, onCommit);

  return (
    <div className="flex items-center gap-2">
      <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground/70" />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={slider.value}
        disabled={disabled}
        onChange={(e) => slider.change(Number(e.target.value))}
        aria-label={`${control.name} in Prozent`}
        aria-valuetext={`${slider.value} Prozent`}
        style={sliderFill(slider.value)}
        className="touch-slider flex-1"
      />
      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
        {raw === null && !slider.pending ? "–" : `${Math.round(slider.value)} %`}
      </span>
    </div>
  );
}

function MuteButton({
  muted,
  unknown,
  disabled,
  onToggle,
}: {
  muted: boolean;
  unknown: boolean;
  disabled: boolean;
  onToggle: (muted: boolean) => void;
}) {
  return (
    <Button
      variant={muted ? "destructive" : "outline"}
      disabled={disabled}
      onClick={() => onToggle(!muted)}
      aria-pressed={muted}
      className="h-10 w-full gap-1.5 sm:h-9"
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      {unknown ? "Stumm schalten" : muted ? "Stumm – wieder an" : "Stumm schalten"}
    </Button>
  );
}
