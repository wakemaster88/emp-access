"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/components/raeume/shared";
import { ActionEditor, emptyAction, type ActionDraft } from "@/components/regeln/action-editor";
import { TRIGGER_HINTS, TRIGGER_LABELS } from "@/components/regeln/shared";
import { deviceControls } from "@/lib/device-controls";
import type { Rule, RuleOptions, RuleTrigger } from "@/components/regeln/types";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Eigene Auswahlfelder wie Eingabefelder: glass-field, 16 px Schrift auf dem Handy (Abschnitt 16).
const selectClass =
  "glass-field h-9 w-full px-2 text-base text-foreground outline-none transition-[color,box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50 max-sm:h-11 md:text-sm";

const TRIGGER_ORDER: RuleTrigger[] = [
  "TIME",
  "OPENING",
  "CLOSING",
  "SUNRISE",
  "SUNSET",
  "MOTION",
  "DEVICE_SWITCHED",
  "SCAN",
  "IDLE",
  "MANUAL",
];

function toDrafts(rule: Rule | null): ActionDraft[] {
  if (!rule) return [emptyAction("DEVICE")];
  return rule.actions.map((a) => ({
    kind: a.kind,
    deviceId: a.deviceId,
    deviceAction: a.deviceAction,
    timerSeconds: a.timerSeconds,
    channel: a.channel ?? "PUSH",
    message: a.message ?? "",
    audioZoneId: a.audioZoneId,
    audioAnnouncementId: a.audioAnnouncementId,
    audioPlaylistId: a.audioPlaylistId,
    audioMode: a.audioAnnouncementId
      ? "announcement"
      : a.audioPlaylistId
        ? "playlist"
        : "stop",
    targetCameraId: a.targetCameraId,
    ptzPresetId: a.ptzPresetId,
    autoTrack: a.autoTrack,
    returnAfterSeconds: a.returnAfterSeconds,
  }));
}

function WeekdayPicker({
  mask,
  disabled,
  onChange,
}: {
  mask: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {WEEKDAYS.map((day, index) => {
        const on = ((mask >> index) & 1) === 1;
        return (
          <button
            key={day}
            type="button"
            disabled={disabled}
            onClick={() => onChange(mask ^ (1 << index))}
            aria-pressed={on}
            className={
              on
                ? "press h-9 w-10 rounded-full bg-primary text-xs font-medium text-primary-foreground disabled:opacity-50 max-sm:size-11"
                : "press h-9 w-10 rounded-full border border-border text-xs text-muted-foreground hover:bg-glass-tile hover:text-foreground disabled:opacity-50 max-sm:size-11"
            }
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}

export function RuleDialog({
  rule,
  options,
  /** Vorbelegter Raum, wenn die Regel aus einem Raum heraus angelegt wird. */
  defaultRoomId,
  open,
  disabled,
  onClose,
}: {
  rule: Rule | null;
  options: RuleOptions;
  defaultRoomId?: number | null;
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [roomId, setRoomId] = useState<number | null>(rule?.roomId ?? defaultRoomId ?? null);
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);

  const [trigger, setTrigger] = useState<RuleTrigger>(rule?.trigger ?? "TIME");
  const [daysOfWeek, setDaysOfWeek] = useState(rule?.daysOfWeek ?? 127);
  const [timeOfDay, setTimeOfDay] = useState(rule?.timeOfDay ?? "08:00");
  const [offsetMinutes, setOffsetMinutes] = useState(rule?.offsetMinutes ?? 0);
  const [cameraId, setCameraId] = useState<number | null>(rule?.cameraId ?? null);
  const [eventType, setEventType] = useState<string>(rule?.eventType ?? "");
  const [triggerDeviceId, setTriggerDeviceId] = useState<number | null>(
    rule?.triggerDeviceId ?? null,
  );
  const [triggerAction, setTriggerAction] = useState<string>(rule?.triggerAction ?? "");
  const [areaId, setAreaId] = useState<number | null>(rule?.areaId ?? null);
  const [scanDirection, setScanDirection] = useState<string>(rule?.scanDirection ?? "");
  const [idleMinutes, setIdleMinutes] = useState<number>(rule?.idleMinutes ?? 30);

  const [operating, setOperating] = useState(rule?.operating ?? "ANY");
  const [operatingScheduleId, setOperatingScheduleId] = useState<number | null>(
    rule?.operatingScheduleId ?? null,
  );
  const [windowStart, setWindowStart] = useState(rule?.windowStart ?? "");
  const [windowEnd, setWindowEnd] = useState(rule?.windowEnd ?? "");
  const [onlyWhenDark, setOnlyWhenDark] = useState(rule?.onlyWhenDark ?? false);
  const [cooldownSeconds, setCooldownSeconds] = useState(rule?.cooldownSeconds ?? 60);

  const [actions, setActions] = useState<ActionDraft[]>(() => toDrafts(rule));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const triggerDevice = options.devices.find((d) => d.id === triggerDeviceId) ?? null;
  const needsOffset = trigger === "OPENING" || trigger === "CLOSING" || trigger === "SUNRISE" || trigger === "SUNSET";

  async function save() {
    if (!name.trim()) return setError("Bitte einen Namen angeben.");
    if (daysOfWeek === 0) return setError("Mindestens ein Wochentag muss gewählt sein.");
    if (trigger === "MOTION" && !cameraId && !roomId) {
      return setError("Bewegung braucht eine Kamera oder einen Raum.");
    }
    if (trigger === "DEVICE_SWITCHED" && !triggerDeviceId) {
      return setError("Bitte das auslösende Gerät wählen.");
    }
    if (trigger === "IDLE" && !roomId) {
      return setError("Ruhe im Raum braucht einen Raum.");
    }
    if (actions.some((a) => a.kind === "DEVICE" && (!a.deviceId || !a.deviceAction))) {
      return setError("Jede Geräte-Aktion braucht Gerät und Befehl.");
    }
    if (actions.some((a) => a.kind === "AUDIO" && !a.audioZoneId)) {
      return setError("Jede Audio-Aktion braucht eine Zone.");
    }

    setSaving(true);
    setError("");
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      roomId,
      isActive,
      trigger,
      daysOfWeek,
      timeOfDay: trigger === "TIME" ? timeOfDay : null,
      offsetMinutes: needsOffset ? offsetMinutes : 0,
      cameraId: trigger === "MOTION" ? cameraId : null,
      eventType: trigger === "MOTION" && eventType ? eventType : null,
      triggerDeviceId: trigger === "DEVICE_SWITCHED" ? triggerDeviceId : null,
      triggerAction: trigger === "DEVICE_SWITCHED" && triggerAction ? triggerAction : null,
      areaId: trigger === "SCAN" ? areaId : null,
      scanDirection: trigger === "SCAN" && scanDirection ? scanDirection : null,
      idleMinutes: trigger === "IDLE" ? idleMinutes : null,
      operating,
      operatingScheduleId,
      windowStart: windowStart || null,
      windowEnd: windowEnd || null,
      onlyWhenDark,
      cooldownSeconds,
      actions: actions.map((a, index) => ({
        kind: a.kind,
        sortOrder: index,
        deviceId: a.deviceId,
        deviceAction: a.deviceAction,
        timerSeconds: a.timerSeconds,
        channel: a.channel,
        message: a.message.trim() || null,
        audioZoneId: a.audioZoneId,
        audioAnnouncementId: a.audioMode === "announcement" ? a.audioAnnouncementId : null,
        audioPlaylistId: a.audioMode === "playlist" ? a.audioPlaylistId : null,
        targetCameraId: a.targetCameraId,
        ptzPresetId: a.ptzPresetId,
        autoTrack: a.autoTrack,
        returnAfterSeconds: a.returnAfterSeconds,
      })),
    };

    const res = rule
      ? await apiRequest(`/api/regeln/${rule.id}`, "PUT", payload)
      : await apiRequest("/api/regeln", "POST", payload);
    setSaving(false);
    if (!res.ok) return setError(res.message);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {rule ? `Regel: ${rule.name}` : "Neue Regel"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1">
              <Label>Name</Label>
              <Input
                value={name}
                disabled={disabled}
                placeholder="z.B. Licht an bei Betriebsbeginn"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {/* Handy: volle Breite wie die übrigen Felder. */}
            <div className="min-w-32 space-y-1 max-sm:w-full">
              <Label>Raum</Label>
              <select
                className={selectClass}
                disabled={disabled}
                value={roomId ?? ""}
                onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">betriebsweit</option>
                {options.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            value={description}
            disabled={disabled}
            placeholder="Beschreibung, optional"
            onChange={(e) => setDescription(e.target.value)}
          />

          <Tabs defaultValue="trigger">
            <TabsList>
              <TabsTrigger value="trigger">
                Auslöser
              </TabsTrigger>
              <TabsTrigger value="conditions">
                Bedingungen
              </TabsTrigger>
              <TabsTrigger value="actions" className="tabular-nums">
                Aktionen ({actions.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="trigger" className="space-y-3">
              <div className="space-y-1">
                <Label>Wann greift die Regel?</Label>
                <select
                  className={selectClass}
                  disabled={disabled}
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value as RuleTrigger)}
                >
                  {TRIGGER_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">{TRIGGER_HINTS[trigger]}</p>
              </div>

              {trigger === "TIME" && (
                <div className="w-32 space-y-1">
                  <Label>Uhrzeit</Label>
                  <Input
                    type="time"
                    disabled={disabled}
                    value={timeOfDay}
                    onChange={(e) => setTimeOfDay(e.target.value)}
                  />
                </div>
              )}

              {needsOffset && (
                <div className="w-40 space-y-1">
                  <Label>Verschiebung (Min.)</Label>
                  <Input
                    type="number"
                    min={-720}
                    max={720}
                    disabled={disabled}
                    value={offsetMinutes}
                    onChange={(e) => setOffsetMinutes(Number(e.target.value) || 0)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Negativ = vorher, positiv = nachher.
                  </p>
                </div>
              )}

              {trigger === "MOTION" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Kamera</Label>
                    <select
                      className={selectClass}
                      disabled={disabled}
                      value={cameraId ?? ""}
                      onChange={(e) => setCameraId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">jede Kamera des Raums</option>
                      {options.cameras.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Ereignisart</Label>
                    <select
                      className={selectClass}
                      disabled={disabled}
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                    >
                      <option value="">jede</option>
                      <option value="PERSON">Person</option>
                      <option value="VEHICLE">Fahrzeug</option>
                      <option value="MOTION">Bewegung</option>
                      <option value="DOORBELL">Klingel (DoorBird)</option>
                    </select>
                  </div>
                </div>
              )}

              {trigger === "DEVICE_SWITCHED" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Auslösendes Gerät</Label>
                    <select
                      className={selectClass}
                      disabled={disabled}
                      value={triggerDeviceId ?? ""}
                      onChange={(e) =>
                        setTriggerDeviceId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">— wählen —</option>
                      {options.devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Nur bei Befehl</Label>
                    <select
                      className={selectClass}
                      disabled={disabled || !triggerDevice}
                      value={triggerAction}
                      onChange={(e) => setTriggerAction(e.target.value)}
                    >
                      <option value="">jeder Befehl</option>
                      {(triggerDevice ? deviceControls(triggerDevice) : []).map((c) => (
                        <option key={c.action} value={c.action}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {trigger === "SCAN" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Zutrittsbereich</Label>
                    <select
                      className={selectClass}
                      disabled={disabled}
                      value={areaId ?? ""}
                      onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">jeder Bereich</option>
                      {options.areas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Richtung</Label>
                    <select
                      className={selectClass}
                      disabled={disabled}
                      value={scanDirection}
                      onChange={(e) => setScanDirection(e.target.value)}
                    >
                      <option value="">beide</option>
                      <option value="IN">Eingang</option>
                      <option value="OUT">Ausgang</option>
                    </select>
                  </div>
                </div>
              )}

              {trigger === "IDLE" && (
                <div className="w-40 space-y-1">
                  <Label>Ruhe seit (Min.)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    disabled={disabled}
                    value={idleMinutes}
                    onChange={(e) => setIdleMinutes(Number(e.target.value) || 1)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Wird alle fünf Minuten geprüft, gemessen an den Kameras des Raums.
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="conditions" className="space-y-3">
              <div className="space-y-1">
                <Label>Wochentage</Label>
                <WeekdayPicker mask={daysOfWeek} disabled={disabled} onChange={setDaysOfWeek} />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Betriebszeit</Label>
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={operating}
                    onChange={(e) => setOperating(e.target.value as typeof operating)}
                  >
                    <option value="ANY">spielt keine Rolle</option>
                    <option value="OPEN">nur während der Betriebszeit</option>
                    <option value="CLOSED">nur außerhalb der Betriebszeit</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Welche Betriebszeit</Label>
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={operatingScheduleId ?? ""}
                    onChange={(e) =>
                      setOperatingScheduleId(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">die des Raums</option>
                    {options.schedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Nur ab</Label>
                  <Input
                    type="time"
                    disabled={disabled}
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Nur bis</Label>
                  <Input
                    type="time"
                    disabled={disabled}
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Sperrzeit (Sek.)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={86400}
                    disabled={disabled}
                    value={cooldownSeconds}
                    onChange={(e) => setCooldownSeconds(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Ein Zeitfenster über Mitternacht ist erlaubt: 22:00 bis 06:00 gilt über Nacht. Die
                Sperrzeit verhindert, dass dieselbe Regel kurz hintereinander mehrfach auslöst.
              </p>

              {/* Kästchen-Baustein; die Beschriftung umschließt es, Antippen des Texts schaltet mit. */}
              <label className="flex items-center gap-2 text-sm max-sm:min-h-11">
                <Checkbox
                  checked={onlyWhenDark}
                  disabled={disabled}
                  onCheckedChange={(v) => setOnlyWhenDark(v === true)}
                />
                Nur bei Dunkelheit (zwischen Sonnenuntergang und Sonnenaufgang)
              </label>

              <label className="flex items-center gap-2 text-sm max-sm:min-h-11">
                <Checkbox
                  checked={isActive}
                  disabled={disabled}
                  onCheckedChange={(v) => setIsActive(v === true)}
                />
                Regel ist aktiv
              </label>
            </TabsContent>

            <TabsContent value="actions">
              <ActionEditor
                actions={actions}
                options={options}
                disabled={disabled}
                onChange={setActions}
              />
            </TabsContent>
          </Tabs>

          {error && <Notice tone="danger" compact title={error} />}
        </div>

        {/* Handy: Tasten volle Breite, Primärtaste oben (docs/design-regeln.md, Abschnitt 16). */}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving || disabled}
            className="min-w-28"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="h-4 w-4" />
                Speichern
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
