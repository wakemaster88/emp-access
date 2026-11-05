"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { ToggleChip, ToggleChipGroup } from "@/components/ui/toggle-chip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Shield,
  ShieldOff,
  Save,
  Cctv,
  FileText,
  ChevronLeft,
  ChevronRight,
  UserRound,
  Car,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SurveillanceConfigDTO {
  id: number | null;
  manualArmed: boolean;
  scheduleEnabled: boolean;
  daysOfWeek: number;
  windowStart: string | null;
  windowEnd: string | null;
  cooldownMinutes: number;
  alertOnPerson: boolean;
  alertOnVehicle: boolean;
  alertTelegram: boolean;
  cameraIds: number[];
  armedNow: boolean;
  updatedAt: string | null;
}

export interface CameraOption {
  id: number;
  name: string;
  enabled: boolean;
}

interface ReportPeriodMeta {
  key: string;
  label: string;
  inProgress: boolean;
  completed: boolean;
  start: string;
  end: string;
}

interface ReportPersonItem {
  id: number;
  kind: "PERSON";
  seenAt: string;
  hasSnapshot: boolean;
  matched: boolean;
  listType: string | null;
  matchScore: number | null;
  camera: { id: number; name: string } | null;
  listedPerson: { id: number; name: string; listType: string } | null;
  snapshotUrl: string | null;
}

interface ReportVehicleItem {
  id: number;
  kind: "VEHICLE";
  seenAt: string;
  hasSnapshot: boolean;
  matched: boolean;
  plate: string | null;
  camera: { id: number; name: string } | null;
  allowedVehicle: { id: number; name: string; plate: string } | null;
  snapshotUrl: string | null;
}

interface ReportEventItem {
  id: number;
  kind: "EVENT";
  type: string;
  startedAt: string;
  endedAt: string | null;
  camera: { id: number; name: string };
}

type ReportTimelineItem = ReportPersonItem | ReportVehicleItem | ReportEventItem;

interface SurveillanceReportDTO {
  period: ReportPeriodMeta & { overnight: boolean };
  periods: ReportPeriodMeta[];
  windowStart: string;
  windowEnd: string;
  summary: {
    persons: number;
    vehicles: number;
    events: number;
    personSnapshots: number;
    vehicleSnapshots: number;
    byType: Record<string, number>;
  };
  timeline: ReportTimelineItem[];
}

const DAYS = [
  { bit: 0, short: "Mo" },
  { bit: 1, short: "Di" },
  { bit: 2, short: "Mi" },
  { bit: 3, short: "Do" },
  { bit: 4, short: "Fr" },
  { bit: 5, short: "Sa" },
  { bit: 6, short: "So" },
];

interface Props {
  initial: SurveillanceConfigDTO;
  cameras: CameraOption[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SurveillanceClient({ initial, cameras }: Props) {
  const [form, setForm] = useState({
    manualArmed: initial.manualArmed,
    scheduleEnabled: initial.scheduleEnabled,
    daysOfWeek: initial.daysOfWeek,
    windowStart: initial.windowStart ?? "22:00",
    windowEnd: initial.windowEnd ?? "08:00",
    cooldownMinutes: initial.cooldownMinutes,
    alertOnPerson: initial.alertOnPerson,
    alertOnVehicle: initial.alertOnVehicle,
    alertTelegram: initial.alertTelegram,
    cameraIds: initial.cameraIds.length
      ? initial.cameraIds
      : cameras.filter((c) => c.enabled).map((c) => c.id),
  });
  const [armedNow, setArmedNow] = useState(initial.armedNow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(initial.updatedAt);

  const [report, setReport] = useState<SurveillanceReportDTO | null>(null);
  const [reportKey, setReportKey] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState("");
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  const loadReport = useCallback(async (period?: string | null) => {
    setReportLoading(true);
    setReportError("");
    try {
      const qs = period ? `?period=${encodeURIComponent(period)}` : "";
      const res = await fetch(`/api/surveillance/report${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReportError(typeof json.error === "string" ? json.error : "Bericht fehlgeschlagen");
        return;
      }
      setReport(json as SurveillanceReportDTO);
      setReportKey(json.period?.key ?? null);
    } catch {
      setReportError("Netzwerkfehler beim Laden des Berichts");
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport(null);
  }, [loadReport]);

  const periodIndex = useMemo(() => {
    if (!report || !reportKey) return -1;
    return report.periods.findIndex((p) => p.key === reportKey);
  }, [report, reportKey]);

  const goPeriod = (delta: number) => {
    if (!report || periodIndex < 0) return;
    const next = report.periods[periodIndex + delta];
    if (next) void loadReport(next.key);
  };

  const selectedSet = useMemo(() => new Set(form.cameraIds), [form.cameraIds]);

  const toggleDay = (bit: number) => {
    setForm((f) => ({
      ...f,
      daysOfWeek: ((f.daysOfWeek >> bit) & 1) === 1 ? f.daysOfWeek & ~(1 << bit) : f.daysOfWeek | (1 << bit),
    }));
  };

  const toggleCamera = (id: number) => {
    setForm((f) => {
      const has = f.cameraIds.includes(id);
      return {
        ...f,
        cameraIds: has ? f.cameraIds.filter((x) => x !== id) : [...f.cameraIds, id],
      };
    });
  };

  const save = useCallback(
    async (patch?: Partial<typeof form>) => {
      setSaving(true);
      setError("");
      const body = { ...form, ...patch };
      try {
        const res = await fetch("/api/surveillance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            windowStart: body.scheduleEnabled ? body.windowStart : body.windowStart,
            windowEnd: body.scheduleEnabled ? body.windowEnd : body.windowEnd,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
          return;
        }
        setForm({
          manualArmed: json.manualArmed,
          scheduleEnabled: json.scheduleEnabled,
          daysOfWeek: json.daysOfWeek,
          windowStart: json.windowStart ?? "22:00",
          windowEnd: json.windowEnd ?? "08:00",
          cooldownMinutes: json.cooldownMinutes,
          alertOnPerson: json.alertOnPerson,
          alertOnVehicle: json.alertOnVehicle,
          alertTelegram: json.alertTelegram ?? true,
          cameraIds: json.cameraIds ?? [],
        });
        setArmedNow(!!json.armedNow);
        setSavedAt(json.updatedAt ?? new Date().toISOString());
        void loadReport(null);
      } catch {
        setError("Netzwerkfehler");
      } finally {
        setSaving(false);
      }
    },
    [form, loadReport]
  );

  const toggleArmed = async () => {
    const next = !form.manualArmed;
    setForm((f) => ({ ...f, manualArmed: next }));
    await save({ manualArmed: next });
  };

  return (
    <div className="space-y-4 sm:space-y-5 max-w-4xl">
      <Card>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div className="flex items-start gap-3">
              {/* Zustand als Symbol-Chip: scharf füllt sich in der Hinweisfarbe. */}
              <IconChip
                icon={armedNow ? Shield : ShieldOff}
                tone={armedNow ? "warning" : "neutral"}
                active={armedNow}
                size="lg"
              />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                    Überwachungsmodus
                  </h2>
                  <Badge variant={armedNow ? "warning" : "neutral"}>
                    {armedNow ? "Jetzt aktiv" : "Inaktiv"}
                  </Badge>
                </div>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Push bei Person oder Fahrzeug auf ausgewählten Kameras. Scharf per Knopf
                  und/oder Zeitplan.
                </p>
              </div>
            </div>
            {/* Glas-Taste in beiden Zuständen: die Beschriftung nennt den manuellen Zustand, die Farbe zeigen Chip, Badge und die Zeile darunter (keine deckende Zustandsfarbe, kein aria-pressed bei wechselnder Beschriftung). */}
            <Button
              size="lg"
              variant="secondary"
              onClick={toggleArmed}
              disabled={saving}
              className="min-w-[140px] max-sm:h-11"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : form.manualArmed ? (
                "Scharf"
              ) : (
                "Aus"
              )}
            </Button>
          </div>
          {form.manualArmed && (
            <p className="mt-3 text-xs text-warning">
              Manuell scharf – unabhängig vom Zeitplan.
            </p>
          )}
          {!form.manualArmed && form.scheduleEnabled && armedNow && (
            <p className="mt-3 text-xs text-muted-foreground">Aktiv durch Zeitplan.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        {/* Kopf: Titel und Fenster links, Zeitraumwahl (Pfeil, Auswahl, Pfeil) oben rechts
            (docs/design-regeln.md, Abschnitt 13). Auf dem Handy steht die Zeitraumwahl als eigene
            Zeile in voller Breite unter Titel und Fenster, nicht zwischen den beiden. */}
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Nachtbericht
            {report?.period.inProgress && (
              <Badge variant="warning">läuft</Badge>
            )}
          </CardTitle>
          {report && (
            <CardDescription className="text-xs">
              Fenster {report.windowStart}–{report.windowEnd} · nur klare
              Personen-/Fahrzeug-Erkennungen mit Snapshot
            </CardDescription>
          )}
          <CardAction className="flex items-center gap-1 max-sm:col-span-full max-sm:row-[3] max-sm:mt-1.5 max-sm:justify-self-stretch">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="max-sm:size-11"
              disabled={reportLoading || periodIndex < 0 || periodIndex >= (report?.periods.length ?? 0) - 1}
              onClick={() => goPeriod(1)}
              title="Ältere Periode"
              aria-label="Ältere Periode"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {/* Natives Auswahlfeld (NativeSelect) in Glas-Optik wie Input, 32 px hoch wie die Pfeiltasten daneben.
                Handy: Breite 0 plus flex-1, sonst gibt die längste Option die Breite vor und schiebt den Kopf über den Kartenrand. */}
            <NativeSelect
              containerClassName="w-auto max-w-[220px] max-sm:w-0 max-sm:max-w-none max-sm:flex-1"
              className="h-8 md:text-xs max-sm:h-11"
              aria-label="Periode"
              value={reportKey ?? ""}
              disabled={reportLoading || !report}
              onChange={(e) => void loadReport(e.target.value)}
            >
              {(report?.periods ?? []).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                  {p.inProgress ? " (läuft)" : ""}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="max-sm:size-11"
              disabled={reportLoading || periodIndex <= 0}
              onClick={() => goPeriod(-1)}
              title="Neuere Periode"
              aria-label="Neuere Periode"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {reportLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Bericht wird geladen…
            </div>
          )}
          {reportError && !reportLoading && (
            <Notice tone="danger" compact title={reportError} />
          )}
          {!reportLoading && report && (
            <>
              {/* Kennzahlen des Zeitraums; zwei Spalten, die dritte über die volle Breite, drei erst ab lg (schmaler kürzt die Versal-Beschriftung).
                  In der Karte als Kachel (variant="tile"), kein Glas auf Glas. */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                <StatCard
                  variant="tile"
                  size="sm"
                  tone="neutral"
                  icon={UserRound}
                  label="Personen"
                  value={report.summary.persons}
                  hint="mit Snapshot"
                />
                <StatCard
                  variant="tile"
                  size="sm"
                  tone="neutral"
                  icon={Car}
                  label="Fahrzeuge"
                  value={report.summary.vehicles}
                  hint="mit Snapshot"
                />
                <StatCard
                  variant="tile"
                  size="sm"
                  tone="neutral"
                  icon={ImageIcon}
                  label="Auffälligkeiten"
                  value={report.summary.personSnapshots + report.summary.vehicleSnapshots}
                  hint="im Zeitraum"
                  className="col-span-2 lg:col-span-1"
                />
              </div>

              {report.timeline.length === 0 ? (
                <EmptyState
                  compact
                  icon={FileText}
                  title="Keine klaren Personen-/Fahrzeug-Erkennungen in diesem Zeitraum."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {report.timeline.map((item) => {
                    if (item.kind === "PERSON") {
                      return (
                        <li key={`p-${item.id}`} className="flex gap-3 py-3 items-start">
                          <button
                            type="button"
                            onClick={() =>
                              setPreview({
                                url: item.snapshotUrl!,
                                title: item.listedPerson?.name ?? "Person",
                              })
                            }
                            className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-glass-border bg-muted"
                          >
                            <img
                              src={item.snapshotUrl!}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline">
                                Person
                              </Badge>
                              <span className="font-mono text-xs text-muted-foreground">
                                {formatTime(item.seenAt)}
                              </span>
                              {item.listType === "BLACKLIST" && (
                                <Badge variant="danger" className="text-xs">
                                  Blacklist
                                </Badge>
                              )}
                              {item.listType === "WHITELIST" && (
                                <Badge variant="success" className="text-xs">
                                  Whitelist
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium text-foreground mt-0.5 truncate">
                              {item.listedPerson?.name ?? "Unbekannte Person"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.camera?.name ?? "Kamera"}
                              {item.matchScore != null
                                ? ` · ${Math.round(item.matchScore * 100)}% Match`
                                : ""}
                            </p>
                          </div>
                        </li>
                      );
                    }
                    if (item.kind !== "VEHICLE") return null;
                    return (
                      <li key={`v-${item.id}`} className="flex gap-3 py-3 items-start">
                        <button
                          type="button"
                          onClick={() =>
                            setPreview({
                              url: item.snapshotUrl!,
                              title:
                                item.allowedVehicle?.name ??
                                item.plate ??
                                "Fahrzeug",
                            })
                          }
                          className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-glass-border bg-muted"
                        >
                          <img
                            src={item.snapshotUrl!}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline">
                              Fahrzeug
                            </Badge>
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatTime(item.seenAt)}
                            </span>
                            {item.matched && (
                              <Badge variant="success" className="text-xs">
                                erlaubt
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium text-foreground mt-0.5 truncate">
                            {item.allowedVehicle?.name ??
                              item.plate ??
                              "Unbekanntes Fahrzeug"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.camera?.name ?? "Kamera"}
                            {item.plate && item.allowedVehicle
                              ? ` · ${item.plate}`
                              : ""}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.title ?? "Snapshot"}</DialogTitle>
          </DialogHeader>
          {preview && (
            // Kamerabild auf schwarzem Grund (Ausnahme laut Design-Regeln).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={preview.title}
              className="w-full max-h-[70vh] object-contain rounded-xl bg-black"
            />
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Zeitplan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Zeitplan aktiv</Label>
              <p className="text-xs text-muted-foreground">Im Fenster automatisch scharf schalten</p>
            </div>
            <Switch
              checked={form.scheduleEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, scheduleEnabled: v }))}
            />
          </div>
          {form.scheduleEnabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="surv-start">Von</Label>
                  <Input
                    id="surv-start"
                    type="time"
                    value={form.windowStart}
                    onChange={(e) => setForm((f) => ({ ...f, windowStart: e.target.value }))}
                    className="mt-1.5 tabular-nums max-sm:h-11"
                  />
                </div>
                <div>
                  <Label htmlFor="surv-end">Bis</Label>
                  <Input
                    id="surv-end"
                    type="time"
                    value={form.windowEnd}
                    onChange={(e) => setForm((f) => ({ ...f, windowEnd: e.target.value }))}
                    className="mt-1.5 tabular-nums max-sm:h-11"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Über Mitternacht möglich (z. B. 22:00–08:00).
              </p>
              <div>
                <Label>Wochentage</Label>
                {/* Umschalt-Chips (ToggleChip), gewählt in weicher Akzent-Tönung.
                    Handy: sieben gleich breite Chips in einer Reihe, 44 px hoch (Tippfläche). */}
                <ToggleChipGroup aria-label="Wochentage" className="mt-1.5 grid grid-cols-7 gap-1 sm:flex sm:flex-wrap">
                  {DAYS.map((d) => (
                    <ToggleChip
                      key={d.bit}
                      size="sm"
                      pressed={((form.daysOfWeek >> d.bit) & 1) === 1}
                      onPressedChange={() => toggleDay(d.bit)}
                      className="min-w-10 px-2.5 max-sm:h-11 max-sm:min-w-0 max-sm:px-0"
                    >
                      {d.short}
                    </ToggleChip>
                  ))}
                </ToggleChipGroup>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alarme</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Person erkannt</Label>
            <Switch
              checked={form.alertOnPerson}
              onCheckedChange={(v) => setForm((f) => ({ ...f, alertOnPerson: v }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>Fahrzeug erkannt</Label>
            <Switch
              checked={form.alertOnVehicle}
              onCheckedChange={(v) => setForm((f) => ({ ...f, alertOnVehicle: v }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Telegram mit Snapshot</Label>
              <p className="text-xs text-muted-foreground">
                Foto + Text an aktive Telegram-Chats (Einstellungen)
              </p>
            </div>
            <Switch
              checked={form.alertTelegram}
              onCheckedChange={(v) => setForm((f) => ({ ...f, alertTelegram: v }))}
            />
          </div>
          <div>
            <Label htmlFor="surv-cooldown">Cooldown (Minuten)</Label>
            <Input
              id="surv-cooldown"
              type="number"
              min={1}
              max={1440}
              value={form.cooldownMinutes}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  cooldownMinutes: Math.max(1, Number(e.target.value) || 5),
                }))
              }
              className="mt-1.5 max-w-[160px] tabular-nums max-sm:h-11"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Pro Kamera und Typ höchstens ein Push in diesem Abstand.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cctv className="h-4 w-4 text-muted-foreground" />
            Kameras
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cameras.length === 0 ? (
            <EmptyState compact icon={Cctv} title="Keine Kameras konfiguriert." />
          ) : (
            cameras.map((c) => {
              const on = selectedSet.has(c.id);
              return (
                // Kamera als Kippkachel: dabei = Auswahl-Tönung, aus = Glas mit gedämpftem Namen
                // (keine Deckkraft auf der ganzen Kachel, sonst fallen Nebentext und Badge unter 4,5:1).
                // Aus: Rand wie glass-tile (Glas auf Glas, im Hellen eine dunkle Haarlinie).
                <button
                  type="button"
                  key={c.id}
                  onClick={() => toggleCamera(c.id)}
                  aria-pressed={on}
                  className={cn(
                    "press w-full flex items-center justify-between gap-3 rounded-tile border px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:min-h-11",
                    on
                      ? "border-primary/40 bg-primary/10"
                      : "border-glass-tile-border bg-glass-tile"
                  )}
                >
                  <span className={cn("min-w-0 font-medium", on ? "text-foreground" : "text-muted-foreground")}>
                    {c.name}
                    {!c.enabled && (
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">deaktiviert</span>
                    )}
                  </span>
                  <Badge variant={on ? "default" : "neutral"}>{on ? "dabei" : "aus"}</Badge>
                </button>
              );
            })
          )}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-sm:h-11"
              onClick={() =>
                setForm((f) => ({ ...f, cameraIds: cameras.map((c) => c.id) }))
              }
            >
              Alle
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-sm:h-11"
              onClick={() => setForm((f) => ({ ...f, cameraIds: [] }))}
            >
              Keine
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <Notice tone="danger" compact title={error} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save()} disabled={saving} className="gap-1.5 max-sm:h-11">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Speichern
        </Button>
        {savedAt && (
          <span className="text-xs text-muted-foreground tabular-nums">
            Zuletzt: {new Date(savedAt).toLocaleString("de-DE")}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Push-Benachrichtigungen müssen unter Einstellungen aktiviert sein.
      </p>
    </div>
  );
}
