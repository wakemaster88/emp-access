"use client";

/**
 * Betriebszeit-Kopplung eines Geraets.
 *
 * Ersetzt den frueheren Wochenplan am Geraet, der nie ausgefuehrt wurde.
 * Schaltzeiten sind Regeln: "Einschalten bei Betriebsbeginn" und
 * "Ausschalten bei Betriebsende" werden hier als zwei Raumregeln angelegt und
 * laufen dann ueber die Regel-Engine – mit Verlauf, Sperrzeit und allem, was
 * die Regeln koennen. Die Karte zeigt ausserdem Raum und Betriebszeit des
 * Geraets und die Regeln, die es bereits schalten.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  DoorClosed,
  DoorOpen,
  Loader2,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { apiRequest, fmtAgo } from "@/components/raeume/shared";
import { useNow } from "@/components/raeume/status";
import { TRIGGER_LABELS, deviceActionLabel, offsetLabel } from "@/components/regeln/shared";
import type { RuleTrigger } from "@/components/regeln/types";
import {
  deviceControlModel,
  deviceControls,
  type DeviceControl,
  type DeviceControlAction,
} from "@/lib/device-controls";
import {
  describeDay,
  isOperatingAt,
  openingForDay,
  type ScheduleSpec,
} from "@/lib/operating-hours";
import { tzYmd } from "@/lib/tz-time";

export interface CouplingDevice {
  id: number;
  name: string;
  type: string;
  category: string | null;
  keyRoomId: number | null;
}

export interface CouplingRoom {
  id: number;
  name: string;
  /** null = der Raum hat keine Betriebszeit. */
  schedule: ScheduleSpec | null;
}

/** Regel, die dieses Geraet schaltet – auf das reduziert, was die Karte zeigt. */
export interface CouplingRule {
  id: number;
  name: string;
  trigger: RuleTrigger;
  offsetMinutes: number;
  isActive: boolean;
  operatingScheduleName: string | null;
  lastRunAt: string | null;
  actions: Array<{ deviceAction: string | null; timerSeconds: number | null }>;
}

const OFFSET_TRIGGERS = new Set<RuleTrigger>(["OPENING", "CLOSING", "SUNRISE", "SUNSET"]);

/** Sperrzeit der angelegten Regeln – laenger als das Auslöse-Fenster des Crons. */
const COUPLING_COOLDOWN_SECONDS = 300;

/**
 * Welcher Befehl "an" und welcher "aus" bedeutet, haengt vom Geraet ab: bei
 * einem Rolltor ist "aus" das Schliessen, bei einem LOQED das Abschliessen.
 * Geraete ohne sinnvolles Paar (Drehkreuz, Tuer, Sensor) bekommen kein
 * Formular, nur die Anzeige.
 */
function couplingControls(device: CouplingDevice): { on: DeviceControl | null; off: DeviceControl | null } {
  const controls = deviceControls(device);
  const find = (action: DeviceControlAction) => controls.find((c) => c.action === action) ?? null;
  switch (deviceControlModel(device)) {
    case "SWITCH":
    case "LIGHT":
    case "VALVE":
      return { on: find("open"), off: find("reset") };
    case "COVER":
      return { on: find("open"), off: find("close") };
    case "LOCK":
      // LOQED: Entriegeln (reset); Nuki hat nur "Tuer oeffnen".
      return { on: find("reset") ?? find("open"), off: find("deactivate") };
    case "PULSE":
      return { on: find("open"), off: null };
    default:
      return { on: null, off: null };
  }
}

function describeRuleTrigger(rule: CouplingRule): string {
  const base = TRIGGER_LABELS[rule.trigger] ?? rule.trigger;
  return OFFSET_TRIGGERS.has(rule.trigger) ? `${base}, ${offsetLabel(rule.offsetMinutes)}` : base;
}

export function OperatingCouplingCard({
  device,
  room,
  schedules,
  rules,
  timezone,
  renderedAt,
  readonly,
}: {
  device: CouplingDevice;
  room: CouplingRoom | null;
  schedules: Array<{ id: number; name: string }>;
  rules: CouplingRule[];
  timezone: string;
  /** Serverzeit beim Rendern – Startwert der Uhr, damit Server und Client gleich rechnen. */
  renderedAt: string;
  readonly: boolean;
}) {
  const router = useRouter();
  const nowMs = useNow(new Date(renderedAt).getTime());
  const now = new Date(nowMs);

  const { on, off } = couplingControls(device);
  const [onEnabled, setOnEnabled] = useState(on !== null);
  const [onOffset, setOnOffset] = useState(0);
  const [offEnabled, setOffEnabled] = useState(off !== null);
  const [offOffset, setOffOffset] = useState(0);
  const [scheduleId, setScheduleId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  // Rückfrage vor dem Löschen; die Regel bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<CouplingRule | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  const open = room?.schedule ? isOperatingAt(room.schedule, now, timezone) : null;
  const today = room?.schedule ? openingForDay(room.schedule, tzYmd(now, timezone)) : null;

  async function createRules() {
    setError("");
    const explicitScheduleId = scheduleId ? Number(scheduleId) : null;
    if (!explicitScheduleId && !room?.schedule) {
      return setError(
        room
          ? `Der Raum „${room.name}“ hat keine Betriebszeit. Hier eine wählen oder dem Raum unter „Räume“ eine zuordnen.`
          : "Das Gerät hängt in keinem Raum. Entweder oben einen Raum zuordnen oder hier eine Betriebszeit wählen.",
      );
    }

    const jobs: Array<{ name: string; trigger: "OPENING" | "CLOSING"; offsetMinutes: number; action: string }> = [];
    if (onEnabled && on) {
      jobs.push({
        name: `${device.name}: ${on.label} bei Betriebsbeginn`,
        trigger: "OPENING",
        offsetMinutes: onOffset,
        action: on.action,
      });
    }
    if (offEnabled && off) {
      jobs.push({
        name: `${device.name}: ${off.label} bei Betriebsende`,
        trigger: "CLOSING",
        offsetMinutes: offOffset,
        action: off.action,
      });
    }
    if (jobs.length === 0) return setError("Mindestens einen der beiden Zeitpunkte wählen.");

    setSaving(true);
    for (const job of jobs) {
      const res = await apiRequest("/api/regeln", "POST", {
        name: job.name,
        roomId: device.keyRoomId,
        trigger: job.trigger,
        offsetMinutes: job.offsetMinutes,
        operatingScheduleId: explicitScheduleId,
        daysOfWeek: 127,
        cooldownSeconds: COUPLING_COOLDOWN_SECONDS,
        actions: [{ kind: "DEVICE", deviceId: device.id, deviceAction: job.action, sortOrder: 0 }],
      });
      if (!res.ok) {
        setSaving(false);
        return setError(res.message);
      }
    }
    setSaving(false);
    router.refresh();
  }

  function askDeleteRule(rule: CouplingRule) {
    setToDelete(rule);
    setConfirmOpen(true);
  }

  async function deleteRule(rule: CouplingRule) {
    setDeleting(rule.id);
    setError("");
    const res = await apiRequest(`/api/regeln/${rule.id}`, "DELETE");
    setDeleting(null);
    if (!res.ok) return setError(res.message);
    router.refresh();
  }

  const canCouple = !readonly && (on !== null || off !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Raum und Betriebszeit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Raum */}
        <div className="flex items-start gap-2 text-sm">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
          {room ? (
            <p>
              <span className="text-muted-foreground">Raum: </span>
              <Link href="/raeume" className="font-medium text-foreground hover:underline">
                {room.name}
              </Link>
            </p>
          ) : (
            <p className="text-muted-foreground">
              Keinem Raum zugeordnet. Über „Bearbeiten“ einen Raum wählen – erst dann hat das Gerät
              eine Betriebszeit.
            </p>
          )}
        </div>

        {/* Betriebszeit: fehlt sie, ist das ein Hinweis; sonst ein ruhiger Zustand
            (geöffnet in der Zustandsfarbe, geschlossen grau). */}
        {room && (
          open === null ? (
            <Notice tone="warning" compact>
              <span>
                Der Raum hat keine Betriebszeit. Unter{" "}
                <Link href="/raeume" className="underline">
                  Räume
                </Link>{" "}
                zuordnen, damit „Betriebsbeginn“ und „Betriebsende“ greifen.
              </span>
            </Notice>
          ) : (
            <div className="glass-tile flex items-center gap-1.5 px-3 py-2 text-xs">
              {open ? <DoorOpen className="h-3.5 w-3.5 shrink-0 text-success" /> : <DoorClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className={open ? "font-medium text-success" : "text-muted-foreground"}>{open ? "geöffnet" : "geschlossen"}</span>
              <span className="truncate text-muted-foreground tabular-nums">
                · {room.schedule?.name} · heute {today ? describeDay(today) : "–"}
              </span>
            </div>
          )
        )}

        {/* Regeln, die dieses Geraet schalten */}
        <div className="space-y-1.5">
          <p className="text-label">
            Regeln für dieses Gerät
          </p>
          {rules.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Noch keine Regel schaltet dieses Gerät.
            </p>
          ) : (
            rules.map((rule) => (
              // Pausierte Regel bleibt lesbar (keine Deckkraft auf Text); den Zustand sagt „· pausiert“.
              <div
                key={rule.id}
                className="glass-tile flex items-center gap-2 px-3 py-2 text-xs"
              >
                <Workflow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Link href="/regeln" className="block truncate font-medium text-foreground hover:underline">
                    {rule.name}
                  </Link>
                  <p className="truncate text-muted-foreground">
                    {describeRuleTrigger(rule)}
                    {(rule.trigger === "OPENING" || rule.trigger === "CLOSING") &&
                      ` (${rule.operatingScheduleName ?? "Betriebszeit des Raums"})`}
                    {" → "}
                    {rule.actions
                      .map((a) =>
                        a.deviceAction
                          ? deviceActionLabel(a.deviceAction, device) +
                            (a.timerSeconds ? ` für ${a.timerSeconds} Sek.` : "")
                          : "schalten",
                      )
                      .join(", ")}
                    {!rule.isActive && " · pausiert"}
                    {rule.isActive && rule.lastRunAt && ` · zuletzt ${fmtAgo(rule.lastRunAt, nowMs)}`}
                  </p>
                </div>
                {!readonly && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive max-sm:size-11"
                    disabled={deleting !== null}
                    onClick={() => askDeleteRule(rule)}
                    title="Regel löschen"
                    aria-label="Regel löschen"
                  >
                    {deleting === rule.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Kopplung anlegen */}
        {canCouple && (
          <div className="glass-tile space-y-3 p-3">
            <div>
              <p className="text-sm font-medium">Mit der Betriebszeit koppeln</p>
              <p className="text-xs text-muted-foreground">
                Legt je Zeitpunkt eine Regel an. Danach lässt sie sich unter „Regeln“ wie jede
                andere anpassen, pausieren oder löschen.
              </p>
            </div>

            {on && (
              <CouplingRow
                label={`${on.label} bei Betriebsbeginn`}
                enabled={onEnabled}
                offset={onOffset}
                onEnabled={setOnEnabled}
                onOffset={setOnOffset}
              />
            )}
            {off && (
              <CouplingRow
                label={`${off.label} bei Betriebsende`}
                enabled={offEnabled}
                offset={offOffset}
                onEnabled={setOffEnabled}
                onOffset={setOffOffset}
              />
            )}

            <div className="space-y-1.5">
              <Label htmlFor="coupling-schedule">Betriebszeit</Label>
              {/* Natives Auswahlfeld im Feld-Look (NativeSelect); auf dem Handy 44 px wie die übrigen Felder der Kachel. */}
              <NativeSelect
                id="coupling-schedule"
                value={scheduleId}
                onChange={(e) => setScheduleId(e.target.value)}
                className="max-sm:h-11"
              >
                <option value="">
                  {room?.schedule
                    ? `die des Raums (${room.schedule.name})`
                    : "die des Raums – derzeit keine"}
                </option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
              {schedules.length === 0 && (
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  Noch keine Betriebszeit angelegt – zuerst unter „Betriebszeiten“ anlegen.
                </p>
              )}
            </div>

            {error && <Notice tone="danger" compact title={error} />}

            <div className="flex justify-end">
              <Button size="sm" onClick={createRules} disabled={saving} className="gap-1.5 max-sm:h-11">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Regeln anlegen
              </Button>
            </div>
          </div>
        )}
        {!canCouple && error && <Notice tone="danger" compact title={error} />}

        {/* Löschen immer mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18).
            Dieselbe Rückfrage wie unter „Regeln“: derselbe Löschweg, der Verlauf bleibt stehen. */}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Regel „{toDelete?.name}“ löschen?</AlertDialogTitle>
              <AlertDialogDescription>Der Verlauf bleibt erhalten.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (toDelete) void deleteRule(toDelete);
                }}
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function CouplingRow({
  label,
  enabled,
  offset,
  onEnabled,
  onOffset,
}: {
  label: string;
  enabled: boolean;
  offset: number;
  onEnabled: (value: boolean) => void;
  onOffset: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {/* Kästchen-Baustein; die ganze Zeile ist Beschriftung, der Text bricht auf dem Handy um statt abzuschneiden. */}
      <label className="flex min-w-0 flex-1 items-center gap-2 max-sm:min-h-11">
        <Checkbox checked={enabled} onCheckedChange={(v) => onEnabled(v === true)} />
        <span className="min-w-0">{label}</span>
      </label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={-720}
          max={720}
          value={offset}
          disabled={!enabled}
          onChange={(e) => onOffset(Number(e.target.value) || 0)}
          className="h-8 w-20 max-sm:h-11"
          aria-label="Verschiebung in Minuten"
        />
        <span className="text-muted-foreground" title="Negativ = vorher, positiv = nachher">
          Min.
        </span>
      </div>
    </div>
  );
}
