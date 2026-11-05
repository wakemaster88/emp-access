"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Save, Loader2, Trash2, Check, MapPin, Cpu, Clock, IdCard, KeyRound,
  Smartphone, Copy, RefreshCw, ExternalLink, History,
} from "lucide-react";
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
  // Rückfragen als Schritt im selben Dialog statt Browser-confirm (docs/design-regeln.md, Abschnitte 16 und 18):
  // Löschen in der Fußzeile, Link erneuern/entziehen direkt bei den Tasten des Mobile-Zugangs.
  const [confirmAction, setConfirmAction] = useState<"delete" | "rotate" | "revoke" | null>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmAction(null);
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

  const tokenConfirm = confirmAction === "rotate" || confirmAction === "revoke" ? confirmAction : null;

  const mobileUrl = form.mobileToken && typeof window !== "undefined"
    ? `${window.location.origin}/m/${form.mobileToken}`
    : null;

  useEffect(() => {
    if (!qrRef.current || !mobileUrl) return;
    const canvas = qrRef.current;
    void import("qrcode").then((m) =>
      m.default.toCanvas(canvas, mobileUrl, {
        width: 180,
        margin: 1,
        color: { dark: "#1e293b", light: "#ffffff" },
      }),
    );
  }, [mobileUrl]);

  async function handleTokenAction(kind: "create" | "rotate" | "revoke") {
    if (!form.id) return;
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
      setConfirmAction(null);
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          {/* Auf dem Handy mittig wie der Kopf des Blatts (DialogHeader), ab sm linksbündig. */}
          <DialogTitle className="flex items-center justify-center gap-2 sm:justify-start">
            <IdCard className="h-5 w-5 text-primary" />
            {isNew ? "Neuen Mitarbeiter anlegen" : (form.firstName || form.lastName)
              ? `${form.firstName} ${form.lastName}`.trim()
              : form.name || "Mitarbeiter bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lade…
          </div>
        ) : (
          <div className="space-y-5">
            {/* Persoenliche Daten */}
            <section className="space-y-3">
              <h3 className="text-label">Person</h3>
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
                    <SelectTrigger id="emp-status" className="w-full"><SelectValue /></SelectTrigger>
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
              <h3 className="text-label">Vertrag</h3>
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
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-label flex items-center gap-1.5 tabular-nums">
                  <MapPin className="h-3.5 w-3.5" /> Bereiche ({form.areaIds.length})
                </h3>
                <Badge variant="neutral" className="tabular-nums">{areas.length} verfügbar</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Klassischer Bereich-Zugang. Mitarbeiter darf an Geräten der zugewiesenen Bereiche scannen.
              </p>
              {/* Auswahlliste aus dem Baustein Checklist: die ganze Zeile schaltet das Kästchen
                  (docs/design-regeln.md, Abschnitt 16). */}
              <Checklist aria-label="Bereiche" maxHeight="12rem">
                {areas.length === 0 && (
                  <EmptyState size="sm" icon={MapPin} title="Keine Bereiche angelegt" />
                )}
                {areas.map((a) => (
                  <ChecklistItem
                    key={a.id}
                    checked={form.areaIds.includes(a.id)}
                    onCheckedChange={() => toggleArea(a.id)}
                    title={a.name}
                  />
                ))}
              </Checklist>
            </section>

            <Separator />

            {/* Direkt-Geraete */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-label flex items-center gap-1.5 tabular-nums">
                  <Cpu className="h-3.5 w-3.5" /> Direkt-Geräte ({form.deviceIds.length})
                </h3>
                <Badge variant="neutral" className="tabular-nums">{devices.length} verfügbar</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Zusätzlicher Zugang zu einzelnen Geräten – auch ohne Bereich-Zugehörigkeit (z.B. nur Nebeneingang).
              </p>
              {/* Gleiche Auswahl wie bei den Bereichen; keine eigene Farbe für Geräte (Abschnitt 3). */}
              <Checklist aria-label="Direkt-Geräte" maxHeight="12rem">
                {devices.length === 0 && (
                  <EmptyState size="sm" icon={Cpu} title="Keine Geräte angelegt" />
                )}
                {devices.map((d) => (
                  <ChecklistItem
                    key={d.id}
                    checked={form.deviceIds.includes(d.id)}
                    onCheckedChange={() => toggleDevice(d.id)}
                    title={d.name}
                    description={`${d.type}${d.category ? ` · ${d.category}` : ""}`}
                  />
                ))}
              </Checklist>
            </section>

            <Separator />

            {/* Wochenplan */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-label flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Zeitsteuerung
                </h3>
                {/* Kästchen statt rohem input: Option im Formular, wirkt erst beim Speichern (Abschnitt 14). */}
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer max-sm:min-h-11">
                  <Checkbox
                    checked={form.scheduleEnabled}
                    onCheckedChange={(v) => setForm({ ...form, scheduleEnabled: v === true })}
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
                <p className="glass-tile px-3 py-2 text-xs text-muted-foreground">
                  Ohne Wochenplan ist der Zugang an allen Wochentagen rund um die Uhr (innerhalb des Vertrags) erlaubt.
                </p>
              )}
            </section>

            {!isNew && form.id && (
              <>
                <Separator />
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-label flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5" /> Mobile PWA
                    </h3>
                    {form.mobileToken && (
                      <Badge variant="success">
                        Aktiv
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Der Mitarbeiter kann diese URL/QR scannen und auf seinem Handy zum Home-Bildschirm hinzuf&uuml;gen. Dort hat er Buttons f&uuml;r alle freigegebenen Ger&auml;te.
                  </p>

                  {form.mobileToken && mobileUrl ? (
                    <div className="glass-tile p-3 space-y-3">
                      {/* Auf dem Handy untereinander: QR oben, darunter Link und Tasten. */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        {/* QR-Code bleibt auf Weiß (Ruhezone und Kontrast zum Scannen, auch im Dunkeln). */}
                        <div className="self-center rounded-lg bg-white p-2 border border-border shrink-0 sm:self-start">
                          <canvas ref={qrRef} className="rounded" />
                        </div>
                        <div className="min-w-0 space-y-2 sm:flex-1">
                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Persoenliche URL</Label>
                            <div className="flex items-center gap-1">
                              <Input
                                value={mobileUrl}
                                readOnly
                                className="font-mono"
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0 max-sm:size-11"
                                onClick={copyMobileUrl}
                                title="Kopieren"
                                aria-label="Kopieren"
                              >
                                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0 max-sm:size-11"
                                asChild
                                title="Im neuen Tab oeffnen"
                                aria-label="Im neuen Tab oeffnen"
                              >
                                <a href={mobileUrl} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            </div>
                          </div>
                          {tokenConfirm ? (
                            <Notice
                              tone="danger"
                              compact
                              title={tokenConfirm === "rotate"
                                ? "Bestehenden Link unguelig machen und neuen erzeugen?"
                                : "Mobile-Zugang wirklich entziehen?"}
                            >
                              <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setConfirmAction(null)}
                                  disabled={tokenBusy}
                                  autoFocus
                                >
                                  Abbrechen
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleTokenAction(tokenConfirm)}
                                  disabled={tokenBusy}
                                >
                                  {tokenBusy
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : tokenConfirm === "rotate" && <RefreshCw className="h-4 w-4" />}
                                  {tokenConfirm === "rotate" ? "Neuen Link erzeugen" : "Zugang entziehen"}
                                </Button>
                              </div>
                            </Notice>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmAction("rotate")}
                                disabled={tokenBusy}
                                className="gap-1"
                              >
                                {tokenBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                Neuen Link erzeugen
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmAction("revoke")}
                                disabled={tokenBusy}
                                className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                Zugang entziehen
                              </Button>
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            Wer den Link hat, hat Zugriff. Bei Verlust &bdquo;Neuen Link erzeugen&ldquo; klicken &mdash; alter Link wird sofort unguelig.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      compact
                      icon={Smartphone}
                      title="Noch kein Mobile-Link erstellt."
                      className="glass-tile"
                      action={
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
                      }
                    />
                  )}
                </section>
              </>
            )}

            {error && <Notice tone="danger" compact title={error} />}
          </div>
        )}

        {confirmAction === "delete" ? (
          // Rückfrage statt Fußzeile: Abbrechen oder endgültig löschen.
          <div className="space-y-3">
            <Notice tone="danger" compact title={`Mitarbeiter ${form.firstName || form.name} wirklich loeschen?`} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmAction(null)} disabled={deleting} autoFocus>
                Abbrechen
              </Button>
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Löschen
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter
            className="gap-2 sm:gap-2"
            start={!isNew && form.id && (
              <Button
                variant="ghost"
                onClick={() => setConfirmAction("delete")}
                disabled={deleting || saving}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Löschen
              </Button>
            )}
          >
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
            <Button onClick={handleSave} disabled={saving || loading} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Speichern
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
