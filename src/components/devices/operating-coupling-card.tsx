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
  Building2,
  CalendarClock,
  DoorClosed,
  DoorOpen,
  Loader2,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorLine, apiRequest, fmtAgo } from "@/components/raeume/shared";
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
import { cn } from "@/lib/utils";

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

  async function deleteRule(rule: CouplingRule) {
    if (!confirm(`Regel „${rule.name}“ löschen?`)) return;
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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground/90">
          <CalendarClock className="h-4 w-4 text-primary" />
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

        {/* Betriebszeit */}
        {room && (
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs",
              open === true
                ? "bg-success/10 text-success"
                : open === false
                  ? "bg-muted/50 text-muted-foreground"
                  : "bg-warning/10 text-warning",
            )}
          >
            {open === null ? (
              <span>
                Der Raum hat keine Betriebszeit. Unter{" "}
                <Link href="/raeume" className="underline">
                  Räume
                </Link>{" "}
                zuordnen, damit „Betriebsbeginn“ und „Betriebsende“ greifen.
              </span>
            ) : (
              <>
                {open ? <DoorOpen className="h-3.5 w-3.5 shrink-0" /> : <DoorClosed className="h-3.5 w-3.5 shrink-0" />}
                <span>{open ? "geöffnet" : "geschlossen"}</span>
                <span className="truncate opacity-70">
                  · {room.schedule?.name} · heute {today ? describeDay(today) : "–"}
                </span>
              </>
            )}
          </div>
        )}

        {/* Regeln, die dieses Geraet schalten */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Regeln für dieses Gerät
          </p>
          {rules.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">
              Noch keine Regel schaltet dieses Gerät.
            </p>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs",
                  !rule.isActive && "opacity-60",
                )}
              >
                <Workflow className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1">
                  <Link href="/regeln" className="block truncate font-medium text-foreground hover:underline">
                    {rule.name}
                  </Link>
                  <p className="truncate text-muted-foreground/70">
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
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 text-muted-foreground/70 hover:text-destructive"
                    disabled={deleting !== null}
                    onClick={() => deleteRule(rule)}
                    title="Regel löschen"
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
          <div className="space-y-3 rounded-lg border border-border p-3">
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

            <div className="space-y-1">
              <Label className="text-xs">Betriebszeit</Label>
              <select
                value={scheduleId}
                onChange={(e) => setScheduleId(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-xs"
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
              </select>
              {schedules.length === 0 && (
                <p className="text-[11px] text-warning">
                  Noch keine Betriebszeit angelegt – zuerst unter „Betriebszeiten“ anlegen.
                </p>
              )}
            </div>

            <ErrorLine message={error} />

            <div className="flex justify-end">
              <Button size="sm" onClick={createRules} disabled={saving} className="h-8 gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Regeln anlegen
              </Button>
            </div>
          </div>
        )}
        {!canCouple && error && <ErrorLine message={error} />}
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
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabled(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        <span className="truncate">{label}</span>
      </label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={-720}
          max={720}
          value={offset}
          disabled={!enabled}
          onChange={(e) => onOffset(Number(e.target.value) || 0)}
          className="h-8 w-20 text-xs"
          aria-label="Verschiebung in Minuten"
        />
        <span className="text-muted-foreground/70" title="Negativ = vorher, positiv = nachher">
          Min.
        </span>
      </div>
    </div>
  );
}
