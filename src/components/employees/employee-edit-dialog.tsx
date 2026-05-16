"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Save, Loader2, Trash2, Check, MapPin, Cpu, Clock, IdCard, KeyRound,
  Smartphone, Copy, RefreshCw, ExternalLink, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WeekScheduleEditor } from "@/components/devices/week-schedule-editor";
import { parseSchedule, emptySchedule, hasAnySchedule } from "@/lib/schedule";
import type { WeekSchedule } from "@/lib/schedule";
import type { AreaOption, DeviceOption } from "./employees-client";

interface EmployeeEditDialogProps {
  target: number | "new" | null;
  areas: AreaOption[];
  devices: DeviceOption[];
  onClose: () => void;
  onSaved: () => void;
  onShowHistory?: (id: number, name: string) => void;
}

interface EmployeeDetail {
  id?: number;
  name: string;
  firstName: string;
  lastName: string;
  rfidCode: string;
  email: string;
  ticketTypeName: string;
  startDate: string;
  endDate: string;
  status: "VALID" | "INVALID" | "PROTECTED";
  profileImage: string;
  areaIds: number[];
  deviceIds: number[];
  weekSchedule: WeekSchedule;
  scheduleEnabled: boolean;
  mobileToken: string | null;
}

function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyEmployee(): EmployeeDetail {
  return {
    name: "",
    firstName: "",
    lastName: "",
    rfidCode: "",
    email: "",
    ticketTypeName: "Mitarbeiter",
    startDate: "",
    endDate: "",
    status: "VALID",
    profileImage: "",
    areaIds: [],
    deviceIds: [],
    weekSchedule: emptySchedule(),
    scheduleEnabled: false,
    mobileToken: null,
  };
}

export function EmployeeEditDialog({ target, areas, devices, onClose, onSaved, onShowHistory }: EmployeeEditDialogProps) {
  const open = target !== null;
  const isNew = target === "new";

  const [form, setForm] = useState<EmployeeDetail>(emptyEmployee());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (isNew) {
      setForm(emptyEmployee());
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/employees/${target}`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((data) => {
        if (cancelled) return;
        const parsedSchedule = parseSchedule(data.weekSchedule);
        setForm({
          id: data.id,
          name: data.name ?? "",
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          rfidCode: data.rfidCode ?? "",
          email: data.email ?? "",
          ticketTypeName: data.ticketTypeName ?? "Mitarbeiter",
          startDate: toDateInput(data.startDate),
          endDate: toDateInput(data.endDate),
          status: (data.status === "INVALID" || data.status === "PROTECTED") ? data.status : "VALID",
          profileImage: data.profileImage ?? "",
          areaIds: Array.isArray(data.areaIds) ? data.areaIds : [],
          deviceIds: Array.isArray(data.deviceIds) ? data.deviceIds : [],
          weekSchedule: parsedSchedule,
          scheduleEnabled: hasAnySchedule(parsedSchedule),
          mobileToken: typeof data.mobileToken === "string" ? data.mobileToken : null,
        });
      })
      .catch((err) => { if (!cancelled) setError(err.message || "Laden fehlgeschlagen"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, target, isNew]);

  const mobileUrl = form.mobileToken && typeof window !== "undefined"
    ? `${window.location.origin}/m/${form.mobileToken}`
    : null;

  useEffect(() => {
    if (!qrRef.current || !mobileUrl) return;
    QRCode.toCanvas(qrRef.current, mobileUrl, {
      width: 180,
      margin: 1,
      color: { dark: "#1e293b", light: "#ffffff" },
    });
  }, [mobileUrl]);

  async function handleTokenAction(kind: "create" | "rotate" | "revoke") {
    if (!form.id) return;
    if (kind === "rotate" && !confirm("Bestehenden Link unguelig machen und neuen erzeugen?")) return;
    if (kind === "revoke" && !confirm("Mobile-Zugang wirklich entziehen?")) return;
    setTokenBusy(true);
    try {
      const res = await fetch(`/api/employees/${form.id}/mobile-token`, {
        method: kind === "revoke" ? "DELETE" : "POST",
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setForm((f) => ({ ...f, mobileToken: kind === "revoke" ? null : (data.token ?? null) }));
      } else {
        setError("Token-Aktion fehlgeschlagen");
      }
    } catch {
      setError("Netzwerkfehler bei Token-Aktion");
    } finally {
      setTokenBusy(false);
    }
  }

  async function copyMobileUrl() {
    if (!mobileUrl) return;
    try {
      await navigator.clipboard.writeText(mobileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  }

  function toggleArea(id: number) {
    setForm((f) => ({
      ...f,
      areaIds: f.areaIds.includes(id) ? f.areaIds.filter((x) => x !== id) : [...f.areaIds, id],
    }));
  }

  function toggleDevice(id: number) {
    setForm((f) => ({
      ...f,
      deviceIds: f.deviceIds.includes(id) ? f.deviceIds.filter((x) => x !== id) : [...f.deviceIds, id],
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim() || [form.firstName, form.lastName].filter(Boolean).join(" ") || "Mitarbeiter",
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        rfidCode: form.rfidCode.trim() || null,
        email: form.email.trim() || null,
        ticketTypeName: form.ticketTypeName.trim() || "Mitarbeiter",
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        status: form.status,
        profileImage: form.profileImage || null,
        areaIds: form.areaIds,
        deviceIds: form.deviceIds,
        weekSchedule: form.scheduleEnabled && hasAnySchedule(form.weekSchedule) ? form.weekSchedule : null,
      };

      const res = await fetch(
        isNew ? "/api/employees" : `/api/employees/${target}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const fe = errBody?.error?.fieldErrors as Record<string, string[]> | undefined;
        const firstFieldErr = fe ? (Object.values(fe).flat()[0] as string | undefined) : undefined;
        setError(firstFieldErr ?? errBody.error ?? "Speichern fehlgeschlagen");
        return;
      }
      onSaved();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!form.id) return;
    if (!confirm(`Mitarbeiter ${form.firstName || form.name} wirklich loeschen?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/employees/${form.id}`, { method: "DELETE" });
      if (res.ok) {
        onSaved();
      } else {
        setError("Loeschen fehlgeschlagen");
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IdCard className="h-5 w-5 text-indigo-500" />
            {isNew ? "Neuen Mitarbeiter anlegen" : (form.firstName || form.lastName)
              ? `${form.firstName} ${form.lastName}`.trim()
              : form.name || "Mitarbeiter bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-slate-500 text-sm">
            <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" />
            Lade…
          </div>
        ) : (
          <div className="space-y-5">
            {/* Persoenliche Daten */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Person</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="emp-firstname">Vorname</Label>
                  <Input id="emp-firstname" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-lastname">Nachname</Label>
                  <Input id="emp-lastname" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-rfid" className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" /> RFID-Code
                  </Label>
                  <Input
                    id="emp-rfid"
                    value={form.rfidCode}
                    onChange={(e) => setForm({ ...form, rfidCode: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-email">Email (optional)</Label>
                  <Input id="emp-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-type">Bezeichnung</Label>
                  <Input id="emp-type" value={form.ticketTypeName} onChange={(e) => setForm({ ...form, ticketTypeName: e.target.value })} placeholder="z.B. Mitarbeiter, Saison, Praktikant" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-status">Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as EmployeeDetail["status"] })}>
                    <SelectTrigger id="emp-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VALID">Aktiv</SelectItem>
                      <SelectItem value="INVALID">Inaktiv</SelectItem>
                      <SelectItem value="PROTECTED">Gesperrt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <Separator />

            {/* Vertrag */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vertrag</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="emp-start">Vertrag ab</Label>
                  <Input id="emp-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-end">Vertrag bis (leer = unbefristet)</Label>
                  <Input id="emp-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>
            </section>

            <Separator />

            {/* Bereiche */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> Bereiche ({form.areaIds.length})
                </h3>
                <Badge variant="secondary" className="text-[10px]">{areas.length} verfügbar</Badge>
              </div>
              <p className="text-xs text-slate-500">
                Klassischer Bereich-Zugang. Mitarbeiter darf an Geräten der zugewiesenen Bereiche scannen.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-2 bg-slate-50/50 dark:bg-slate-900/30">
                {areas.length === 0 && (
                  <p className="col-span-full text-xs text-slate-400 text-center py-4">Keine Bereiche angelegt</p>
                )}
                {areas.map((a) => {
                  const checked = form.areaIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleArea(a.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-left transition-colors",
                        checked
                          ? "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300 ring-1 ring-sky-300 dark:ring-sky-700"
                          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      )}
                    >
                      <div className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                        checked ? "bg-sky-500 border-sky-500" : "border-slate-300 dark:border-slate-600"
                      )}>
                        {checked && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <span className="truncate">{a.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <Separator />

            {/* Direkt-Geraete */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5" /> Direkt-Geräte ({form.deviceIds.length})
                </h3>
                <Badge variant="secondary" className="text-[10px]">{devices.length} verfügbar</Badge>
              </div>
              <p className="text-xs text-slate-500">
                Zusätzlicher Zugang zu einzelnen Geräten – auch ohne Bereich-Zugehörigkeit (z.B. nur Nebeneingang).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-2 bg-slate-50/50 dark:bg-slate-900/30">
                {devices.length === 0 && (
                  <p className="col-span-full text-xs text-slate-400 text-center py-4">Keine Geräte angelegt</p>
                )}
                {devices.map((d) => {
                  const checked = form.deviceIds.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleDevice(d.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-left transition-colors",
                        checked
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300 ring-1 ring-rose-300 dark:ring-rose-700"
                          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      )}
                    >
                      <div className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                        checked ? "bg-rose-500 border-rose-500" : "border-slate-300 dark:border-slate-600"
                      )}>
                        {checked && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate">{d.name}</p>
                        <p className="text-[10px] text-slate-400">{d.type}{d.category ? ` · ${d.category}` : ""}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <Separator />

            {/* Wochenplan */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Zeitsteuerung
                </h3>
                <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.scheduleEnabled}
                    onChange={(e) => setForm({ ...form, scheduleEnabled: e.target.checked })}
                    className="rounded"
                  />
                  Wochenplan aktiv
                </label>
              </div>
              {form.scheduleEnabled ? (
                <WeekScheduleEditor
                  value={form.weekSchedule}
                  onChange={(s) => setForm({ ...form, weekSchedule: s })}
                />
              ) : (
                <p className="text-xs text-slate-400 italic px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/30 border border-dashed border-slate-200 dark:border-slate-700">
                  Ohne Wochenplan ist der Zugang an allen Wochentagen rund um die Uhr (innerhalb des Vertrags) erlaubt.
                </p>
              )}
            </section>

            {!isNew && form.id && (
              <>
                <Separator />
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5" /> Mobile PWA
                    </h3>
                    {form.mobileToken && (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px]">
                        Aktiv
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Der Mitarbeiter kann diese URL/QR scannen und auf seinem Handy zum Home-Bildschirm hinzuf&uuml;gen. Dort hat er Buttons f&uuml;r alle freigegebenen Ger&auml;te.
                  </p>

                  {form.mobileToken && mobileUrl ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-white p-2 border border-slate-200 shrink-0">
                          <canvas ref={qrRef} className="rounded" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase tracking-wide text-slate-500">Persoenliche URL</Label>
                            <div className="flex items-center gap-1">
                              <Input
                                value={mobileUrl}
                                readOnly
                                className="font-mono text-xs h-8"
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={copyMobileUrl}
                                title="Kopieren"
                              >
                                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                asChild
                                title="Im neuen Tab oeffnen"
                              >
                                <a href={mobileUrl} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleTokenAction("rotate")}
                              disabled={tokenBusy}
                              className="h-7 text-xs gap-1"
                            >
                              {tokenBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                              Neuen Link erzeugen
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTokenAction("revoke")}
                              disabled={tokenBusy}
                              className="h-7 text-xs gap-1 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            >
                              Zugang entziehen
                            </Button>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            Wer den Link hat, hat Zugriff. Bei Verlust &bdquo;Neuen Link erzeugen&ldquo; klicken &mdash; alter Link wird sofort unguelig.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-4 text-center space-y-2">
                      <p className="text-xs text-slate-500">Noch kein Mobile-Link erstellt.</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleTokenAction("create")}
                        disabled={tokenBusy}
                        className="gap-1.5"
                      >
                        {tokenBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                        Mobile-Zugang erstellen
                      </Button>
                    </div>
                  )}
                </section>
              </>
            )}

            {error && (
              <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {!isNew && form.id && (
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="mr-auto text-slate-400 hover:text-rose-500"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Löschen
            </Button>
          )}
          {!isNew && form.id && onShowHistory && (
            <Button
              variant="outline"
              onClick={() => {
                const display = [form.firstName, form.lastName].filter(Boolean).join(" ") || form.name;
                onShowHistory(form.id!, display);
              }}
              disabled={saving}
              className="gap-1.5"
            >
              <History className="h-4 w-4" />
              Verlauf
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={saving || loading} className="bg-indigo-600 hover:bg-indigo-700 gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
