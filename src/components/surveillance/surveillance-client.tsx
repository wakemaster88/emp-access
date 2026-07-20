"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
    <div className="space-y-4 max-w-4xl">
      <Card className="border-slate-200 dark:border-slate-800">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "rounded-xl p-3",
                  armedNow
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                )}
              >
                {armedNow ? <Shield className="h-7 w-7" /> : <ShieldOff className="h-7 w-7" />}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Überwachungsmodus
                  </h2>
                  <Badge
                    variant={armedNow ? "default" : "secondary"}
                    className={armedNow ? "bg-amber-600 hover:bg-amber-600" : ""}
                  >
                    {armedNow ? "Jetzt aktiv" : "Inaktiv"}
                  </Badge>
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  Push bei Person oder Fahrzeug auf ausgewählten Kameras. Scharf per Knopf
                  und/oder Zeitplan.
                </p>
              </div>
            </div>
            <Button
              size="lg"
              onClick={toggleArmed}
              disabled={saving}
              className={cn(
                "min-w-[140px]",
                form.manualArmed
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-slate-700 hover:bg-slate-800"
              )}
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
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              Manuell scharf – unabhängig vom Zeitplan.
            </p>
          )}
          {!form.manualArmed && form.scheduleEnabled && armedNow && (
            <p className="mt-3 text-xs text-slate-500">Aktiv durch Zeitplan.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Nachtbericht
              {report?.period.inProgress && (
                <Badge className="bg-amber-600 hover:bg-amber-600">läuft</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={reportLoading || periodIndex < 0 || periodIndex >= (report?.periods.length ?? 0) - 1}
                onClick={() => goPeriod(1)}
                title="Ältere Periode"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <select
                className="h-8 max-w-[220px] rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
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
              </select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={reportLoading || periodIndex <= 0}
                onClick={() => goPeriod(-1)}
                title="Neuere Periode"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {report && (
            <p className="text-xs text-slate-500 mt-1">
              Fenster {report.windowStart}–{report.windowEnd} · nur klare
              Personen-/Fahrzeug-Erkennungen mit Snapshot
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {reportLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Bericht wird geladen…
            </div>
          )}
          {reportError && !reportLoading && (
            <p className="text-sm text-red-600">{reportError}</p>
          )}
          {!reportLoading && report && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <UserRound className="h-3.5 w-3.5" />
                    Personen
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{report.summary.persons}</p>
                  <p className="text-[11px] text-slate-400">mit Snapshot</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Car className="h-3.5 w-3.5" />
                    Fahrzeuge
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{report.summary.vehicles}</p>
                  <p className="text-[11px] text-slate-400">mit Snapshot</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Auffälligkeiten
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {report.summary.personSnapshots + report.summary.vehicleSnapshots}
                  </p>
                  <p className="text-[11px] text-slate-400">im Zeitraum</p>
                </div>
              </div>

              {report.timeline.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  Keine klaren Personen-/Fahrzeug-Erkennungen in diesem Zeitraum.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
                  {report.timeline.map((item) => {
                    if (item.kind === "PERSON") {
                      return (
                        <li key={`p-${item.id}`} className="flex gap-3 p-3 items-start">
                          <button
                            type="button"
                            onClick={() =>
                              setPreview({
                                url: item.snapshotUrl!,
                                title: item.listedPerson?.name ?? "Person",
                              })
                            }
                            className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900"
                          >
                            <img
                              src={item.snapshotUrl!}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-[10px]">
                                Person
                              </Badge>
                              <span className="font-mono text-xs text-slate-500">
                                {formatTime(item.seenAt)}
                              </span>
                              {item.listType === "BLACKLIST" && (
                                <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 text-xs">
                                  Blacklist
                                </Badge>
                              )}
                              {item.listType === "WHITELIST" && (
                                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                                  Whitelist
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white mt-0.5 truncate">
                              {item.listedPerson?.name ?? "Unbekannte Person"}
                            </p>
                            <p className="text-xs text-slate-500">
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
                      <li key={`v-${item.id}`} className="flex gap-3 p-3 items-start">
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
                          className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <img
                            src={item.snapshotUrl!}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">
                              Fahrzeug
                            </Badge>
                            <span className="font-mono text-xs text-slate-500">
                              {formatTime(item.seenAt)}
                            </span>
                            {item.matched && (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                                erlaubt
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white mt-0.5 truncate">
                            {item.allowedVehicle?.name ??
                              item.plate ??
                              "Unbekanntes Fahrzeug"}
                          </p>
                          <p className="text-xs text-slate-500">
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.title ?? "Snapshot"}</DialogTitle>
          </DialogHeader>
          {preview && (
            <img
              src={preview.url}
              alt={preview.title}
              className="w-full max-h-[70vh] object-contain rounded-md bg-slate-100 dark:bg-slate-900"
            />
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Zeitplan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Zeitplan aktiv</Label>
              <p className="text-xs text-slate-500">Im Fenster automatisch scharf schalten</p>
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
                  />
                </div>
                <div>
                  <Label htmlFor="surv-end">Bis</Label>
                  <Input
                    id="surv-end"
                    type="time"
                    value={form.windowEnd}
                    onChange={(e) => setForm((f) => ({ ...f, windowEnd: e.target.value }))}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Über Mitternacht möglich (z. B. 22:00–08:00).
              </p>
              <div>
                <Label>Wochentage</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {DAYS.map((d) => {
                    const selected = ((form.daysOfWeek >> d.bit) & 1) === 1;
                    return (
                      <button
                        type="button"
                        key={d.bit}
                        onClick={() => toggleDay(d.bit)}
                        className={cn(
                          "h-8 min-w-[40px] px-2 rounded-lg text-xs font-semibold transition-colors",
                          selected
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        )}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Alarme</CardTitle>
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
              <p className="text-xs text-slate-500">
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
              className="mt-1 max-w-[160px]"
            />
            <p className="mt-1 text-xs text-slate-500">
              Pro Kamera und Typ höchstens ein Push in diesem Abstand.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cctv className="h-4 w-4" />
            Kameras
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cameras.length === 0 ? (
            <p className="text-sm text-slate-500">Keine Kameras konfiguriert.</p>
          ) : (
            cameras.map((c) => {
              const on = selectedSet.has(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => toggleCamera(c.id)}
                  className={cn(
                    "w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    on
                      ? "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40"
                      : "border-slate-200 dark:border-slate-800 opacity-70"
                  )}
                >
                  <span className="font-medium text-slate-900 dark:text-white">
                    {c.name}
                    {!c.enabled && (
                      <span className="ml-2 text-xs text-slate-400">deaktiviert</span>
                    )}
                  </span>
                  <Badge variant={on ? "default" : "secondary"}>{on ? "dabei" : "aus"}</Badge>
                </button>
              );
            })
          )}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
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
              onClick={() => setForm((f) => ({ ...f, cameraIds: [] }))}
            >
              Keine
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={() => save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Speichern
        </Button>
        {savedAt && (
          <span className="text-xs text-slate-400">
            Zuletzt: {new Date(savedAt).toLocaleString("de-DE")}
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Push-Benachrichtigungen müssen unter Einstellungen aktiviert sein.
      </p>
    </div>
  );
}
