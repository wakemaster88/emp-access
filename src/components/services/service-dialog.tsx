"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Trash2, Save, Settings2, Link2, MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";

function toDateInput(val: string | Date | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

export interface ServiceData {
  id: number;
  name: string;
  annyNames: string | null;
  defaultValidityType?: string | null;
  defaultStartDate?: string | Date | null;
  defaultEndDate?: string | Date | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
  defaultValidityDurationMinutes?: number | null;
  allowReentry?: boolean;
}

interface AreaRef {
  id: number;
  name: string;
}

export interface ServiceAreaEntry {
  areaId: number;
  areaName: string;
  defaultValidityType: string;
  defaultStartDate: string;
  defaultEndDate: string;
  defaultSlotStart: string;
  defaultSlotEnd: string;
  defaultValidityDurationMinutes: string;
}

export type InitialServiceAreaInput = {
  areaId: number;
  areaName: string;
  defaultValidityType?: string | null;
  defaultStartDate?: string | Date | null;
  defaultEndDate?: string | Date | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
  defaultValidityDurationMinutes?: number | null;
};

interface ServiceDialogProps {
  service: ServiceData | null;
  initialServiceAreas: InitialServiceAreaInput[];
  areas: AreaRef[];
  annyServices: string[];
  annyResources: string[];
  open: boolean;
  onClose: () => void;
}

type TabId = "settings" | "anny" | "areas";

function CheckList({
  items,
  selected,
  onToggle,
  emptyText,
}: {
  items: { key: string; label: string }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="text-[11px] text-slate-400 py-4 text-center">{emptyText}</p>;
  }

  return (
    <div className="max-h-[320px] overflow-y-auto space-y-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-1">
      {items.map(({ key, label }) => {
        const isSelected = selected.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className={cn(
              "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              isSelected
                ? "bg-violet-50 dark:bg-violet-900/20"
                : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
            )}
          >
            <div className={cn(
              "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
              isSelected
                ? "bg-violet-500 border-violet-500"
                : "border-slate-300 dark:border-slate-600"
            )}>
              {isSelected && <Check className="h-3 w-3 text-white" />}
            </div>
            <span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function toServiceAreaEntry(areaId: number, areaName: string, defaults?: Partial<ServiceAreaEntry>): ServiceAreaEntry {
  return {
    areaId,
    areaName,
    defaultValidityType: defaults?.defaultValidityType ?? "none",
    defaultStartDate: defaults?.defaultStartDate ?? "",
    defaultEndDate: defaults?.defaultEndDate ?? "",
    defaultSlotStart: defaults?.defaultSlotStart ?? "",
    defaultSlotEnd: defaults?.defaultSlotEnd ?? "",
    defaultValidityDurationMinutes: defaults?.defaultValidityDurationMinutes ?? "",
  };
}

export function ServiceDialog({
  service, initialServiceAreas,
  areas, annyServices, annyResources,
  open, onClose,
}: ServiceDialogProps) {
  const router = useRouter();
  const isNew = !service;
  const [tab, setTab] = useState<TabId>("settings");
  const [name, setName] = useState("");
  const [selectedAnny, setSelectedAnny] = useState<Set<string>>(new Set());
  const [serviceAreas, setServiceAreas] = useState<ServiceAreaEntry[]>([]);
  const [defaultValidityType, setDefaultValidityType] = useState<string>("none");
  const [defaultStartDate, setDefaultStartDate] = useState("");
  const [defaultEndDate, setDefaultEndDate] = useState("");
  const [defaultSlotStart, setDefaultSlotStart] = useState("");
  const [defaultSlotEnd, setDefaultSlotEnd] = useState("");
  const [defaultValidityDurationMinutes, setDefaultValidityDurationMinutes] = useState("");
  const [allowReentry, setAllowReentry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const hasAnny = annyServices.length > 0 || annyResources.length > 0;

  useEffect(() => {
    if (open) {
      setError("");
      setTab("settings");
      if (service) {
        setName(service.name);
        const parsed: string[] = service.annyNames
          ? (() => { try { return JSON.parse(service.annyNames); } catch { return []; } })()
          : [];
        setSelectedAnny(new Set(parsed));
        setServiceAreas(initialServiceAreas.map((sa) => toServiceAreaEntry(sa.areaId, sa.areaName, {
          defaultValidityType: sa.defaultValidityType ?? "none",
          defaultStartDate: typeof sa.defaultStartDate === "string" ? sa.defaultStartDate : toDateInput(sa.defaultStartDate),
          defaultEndDate: typeof sa.defaultEndDate === "string" ? sa.defaultEndDate : toDateInput(sa.defaultEndDate),
          defaultSlotStart: sa.defaultSlotStart ?? "",
          defaultSlotEnd: sa.defaultSlotEnd ?? "",
          defaultValidityDurationMinutes: sa.defaultValidityDurationMinutes != null ? String(sa.defaultValidityDurationMinutes) : "",
        })));
        setDefaultValidityType(service.defaultValidityType ?? "none");
        setDefaultStartDate(toDateInput(service.defaultStartDate));
        setDefaultEndDate(toDateInput(service.defaultEndDate));
        setDefaultSlotStart(service.defaultSlotStart ?? "");
        setDefaultSlotEnd(service.defaultSlotEnd ?? "");
        setDefaultValidityDurationMinutes(service.defaultValidityDurationMinutes != null ? String(service.defaultValidityDurationMinutes) : "");
        setAllowReentry(service.allowReentry ?? false);
      } else {
        setName("");
        setSelectedAnny(new Set());
        setServiceAreas([]);
        setDefaultValidityType("none");
        setDefaultStartDate("");
        setDefaultEndDate("");
        setDefaultSlotStart("");
        setDefaultSlotEnd("");
        setDefaultValidityDurationMinutes("");
        setAllowReentry(false);
      }
    }
  }, [open, service, initialServiceAreas]);

  function toggleAnny(key: string) {
    setSelectedAnny((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function addServiceArea(areaId: number) {
    const area = areas.find((a) => a.id === areaId);
    if (!area || serviceAreas.some((sa) => sa.areaId === areaId)) return;
    setServiceAreas((prev) => [...prev, toServiceAreaEntry(area.id, area.name)]);
  }

  function removeServiceArea(areaId: number) {
    setServiceAreas((prev) => prev.filter((sa) => sa.areaId !== areaId));
  }

  function updateServiceArea(areaId: number, updates: Partial<ServiceAreaEntry>) {
    setServiceAreas((prev) =>
      prev.map((sa) => (sa.areaId === areaId ? { ...sa, ...updates } : sa))
    );
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        annyNames: [...selectedAnny],
        allowReentry,
        areas: serviceAreas.map((sa) => {
          const out: Record<string, unknown> = { areaId: sa.areaId };
          if (sa.defaultValidityType && sa.defaultValidityType !== "none") {
            out.defaultValidityType = sa.defaultValidityType;
            if (sa.defaultValidityType === "DATE_RANGE") {
              if (sa.defaultStartDate) out.defaultStartDate = new Date(sa.defaultStartDate).toISOString();
              if (sa.defaultEndDate) out.defaultEndDate = new Date(sa.defaultEndDate).toISOString();
            } else if (sa.defaultValidityType === "TIME_SLOT") {
              out.defaultSlotStart = sa.defaultSlotStart || null;
              out.defaultSlotEnd = sa.defaultSlotEnd || null;
            } else if (sa.defaultValidityType === "DURATION" && sa.defaultValidityDurationMinutes) {
              out.defaultValidityDurationMinutes = Number(sa.defaultValidityDurationMinutes);
            }
          } else {
            out.defaultValidityType = null;
            out.defaultStartDate = null;
            out.defaultEndDate = null;
            out.defaultSlotStart = null;
            out.defaultSlotEnd = null;
            out.defaultValidityDurationMinutes = null;
          }
          return out;
        }),
      };
      if (defaultValidityType && defaultValidityType !== "none") {
        payload.defaultValidityType = defaultValidityType;
        if (defaultValidityType === "DATE_RANGE") {
          if (defaultStartDate) payload.defaultStartDate = new Date(defaultStartDate).toISOString();
          if (defaultEndDate) payload.defaultEndDate = new Date(defaultEndDate).toISOString();
        } else if (defaultValidityType === "TIME_SLOT") {
          payload.defaultSlotStart = defaultSlotStart || null;
          payload.defaultSlotEnd = defaultSlotEnd || null;
        } else if (defaultValidityType === "DURATION" && defaultValidityDurationMinutes) {
          payload.defaultValidityDurationMinutes = Number(defaultValidityDurationMinutes);
        }
      } else {
        payload.defaultValidityType = null;
        payload.defaultStartDate = null;
        payload.defaultEndDate = null;
        payload.defaultSlotStart = null;
        payload.defaultSlotEnd = null;
        payload.defaultValidityDurationMinutes = null;
      }
      const url = isNew ? "/api/services" : `/api/services/${service!.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Fehler beim Speichern");
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!service || !confirm(`Service "${service.name}" wirklich löschen?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/services/${service.id}`, { method: "DELETE" });
      onClose();
      router.refresh();
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  const annyItems = [
    ...annyServices.map((n) => ({ key: n, label: `${n} (Service)` })),
    ...annyResources.map((n) => ({ key: n, label: `${n} (Resource)` })),
  ];
  const areaItems = areas.map((a) => ({ key: String(a.id), label: a.name }));
  const availableAreasToAdd = areas.filter((a) => !serviceAreas.some((sa) => sa.areaId === a.id));

  const tabClass = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
      active
        ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
    }`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-base">{isNew ? "Neuen Service anlegen" : "Service bearbeiten"}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          <button type="button" onClick={() => setTab("settings")} className={tabClass(tab === "settings")}>
            <Settings2 className="h-3 w-3" />
            Einstellungen
          </button>
          {hasAnny && (
            <button type="button" onClick={() => setTab("anny")} className={tabClass(tab === "anny")}>
              <Link2 className="h-3 w-3" />
              anny{selectedAnny.size > 0 && ` (${selectedAnny.size})`}
            </button>
          )}
          <button type="button" onClick={() => setTab("areas")} className={tabClass(tab === "areas")}>
            <MapPin className="h-3 w-3" />
            Resourcen{serviceAreas.length > 0 && ` (${serviceAreas.length})`}
          </button>
        </div>

        {tab === "settings" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="svc-name" className="text-xs">Name <span className="text-rose-500">*</span></Label>
              <Input
                id="svc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Strandbad Tageskarte, Ferienkurs"
                required
                autoFocus
                className="h-9"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Wiedereinlass</p>
                <p className="text-[11px] text-slate-500">Bei Scan an Ausgang: Ticket wieder gültig setzen</p>
              </div>
              <Switch checked={allowReentry} onCheckedChange={setAllowReentry} />
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-2">
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Standard-Gültigkeit für neue Tickets</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Gültigkeitstyp</Label>
                <Select value={defaultValidityType} onValueChange={setDefaultValidityType}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Kein Standard" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Standard</SelectItem>
                    <SelectItem value="DATE_RANGE">Zeitraum (Tage)</SelectItem>
                    <SelectItem value="TIME_SLOT">Zeitslot (Uhrzeit)</SelectItem>
                    <SelectItem value="DURATION">Dauer ab 1. Scan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {defaultValidityType === "DATE_RANGE" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Gültig ab</Label>
                    <Input type="date" className="h-9 text-xs" value={defaultStartDate} onChange={(e) => setDefaultStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Gültig bis</Label>
                    <Input type="date" className="h-9 text-xs" value={defaultEndDate} onChange={(e) => setDefaultEndDate(e.target.value)} />
                  </div>
                </div>
              )}
              {defaultValidityType === "TIME_SLOT" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Slot von</Label>
                    <Input type="time" className="h-9 text-xs" value={defaultSlotStart} onChange={(e) => setDefaultSlotStart(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Slot bis</Label>
                    <Input type="time" className="h-9 text-xs" value={defaultSlotEnd} onChange={(e) => setDefaultSlotEnd(e.target.value)} />
                  </div>
                </div>
              )}
              {defaultValidityType === "DURATION" && (
                <div className="space-y-1">
                  <Label className="text-xs">Dauer (Minuten)</Label>
                  <div className="flex gap-2 items-center">
                    <Input type="number" min={1} className="h-9 text-xs flex-1" placeholder="z.B. 120" value={defaultValidityDurationMinutes} onChange={(e) => setDefaultValidityDurationMinutes(e.target.value)} />
                    <Button type="button" variant="outline" size="sm" className="h-9 text-xs shrink-0" onClick={() => setDefaultValidityDurationMinutes("1440")}>
                      1 Tag
                    </Button>
                  </div>
                  <p className="text-[10px] text-slate-400">1 Tag = 1440 Minuten</p>
                </div>
              )}
            </div>

            {service && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-1">
                <p className="text-[11px] text-slate-500">Zusammenfassung</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAnny.size > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {selectedAnny.size} anny {selectedAnny.size === 1 ? "Verknüpfung" : "Verknüpfungen"}
                    </Badge>
                  )}
                  {serviceAreas.length > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {serviceAreas.length} {serviceAreas.length === 1 ? "Resource" : "Resourcen"}
                    </Badge>
                  )}
                  {selectedAnny.size === 0 && serviceAreas.length === 0 && (
                    <span className="text-[10px] text-slate-400">Keine Verknüpfungen</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "anny" && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Wähle anny Services und Ressourcen, die diesem Service zugeordnet werden. Tickets mit diesen Namen werden beim Sync automatisch verknüpft.
            </p>
            <CheckList
              items={annyItems}
              selected={selectedAnny}
              onToggle={toggleAnny}
              emptyText="Keine anny Einträge gefunden. Bitte erst synchronisieren."
            />
            {selectedAnny.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{selectedAnny.size} ausgewählt</Badge>
                <button
                  type="button"
                  onClick={() => setSelectedAnny(new Set())}
                  className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors"
                >
                  Alle abwählen
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "areas" && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">
              Resourcen hinzufügen und pro Resource die Gültigkeit für Service-Tickets einstellen. Tickets erscheinen im Dashboard in allen zugeordneten Resourcen.
            </p>
            {availableAreasToAdd.length > 0 && (
              <div className="flex gap-2 items-center">
                <Select
                  value=""
                  onValueChange={(v) => { const id = Number(v); if (id) addServiceArea(id); }}
                >
                  <SelectTrigger className="h-9 text-xs flex-1">
                    <SelectValue placeholder="Resource hinzufügen …" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAreasToAdd.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {serviceAreas.length === 0 ? (
              <p className="text-[11px] text-slate-400 py-4 text-center rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                Noch keine Resourcen zugeordnet. Resource oben hinzufügen.
              </p>
            ) : (
              <div className="space-y-3 max-h-[320px] overflow-y-auto">
                {serviceAreas.map((sa) => (
                  <div
                    key={sa.areaId}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{sa.areaName}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                        onClick={() => removeServiceArea(sa.areaId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-slate-500">Gültigkeit für diese Resource</Label>
                      <Select
                        value={sa.defaultValidityType}
                        onValueChange={(v) => updateServiceArea(sa.areaId, { defaultValidityType: v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Kein Standard</SelectItem>
                          <SelectItem value="DATE_RANGE">Zeitraum (Tage)</SelectItem>
                          <SelectItem value="TIME_SLOT">Zeitslot (Uhrzeit)</SelectItem>
                          <SelectItem value="DURATION">Dauer ab 1. Scan</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {sa.defaultValidityType === "DATE_RANGE" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <Label className="text-[10px]">Gültig ab</Label>
                          <Input
                            type="date"
                            className="h-8 text-xs"
                            value={sa.defaultStartDate}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultStartDate: e.target.value })}
                          />
                        </div>
                        <div className="space-y-0.5">
                          <Label className="text-[10px]">Gültig bis</Label>
                          <Input
                            type="date"
                            className="h-8 text-xs"
                            value={sa.defaultEndDate}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultEndDate: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                    {sa.defaultValidityType === "TIME_SLOT" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <Label className="text-[10px]">Slot von</Label>
                          <Input
                            type="time"
                            className="h-8 text-xs"
                            value={sa.defaultSlotStart}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultSlotStart: e.target.value })}
                          />
                        </div>
                        <div className="space-y-0.5">
                          <Label className="text-[10px]">Slot bis</Label>
                          <Input
                            type="time"
                            className="h-8 text-xs"
                            value={sa.defaultSlotEnd}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultSlotEnd: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                    {sa.defaultValidityType === "DURATION" && (
                      <div className="space-y-0.5">
                        <Label className="text-[10px]">Dauer (Minuten)</Label>
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            min={1}
                            className="h-8 text-xs flex-1"
                            placeholder="z.B. 120"
                            value={sa.defaultValidityDurationMinutes}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultValidityDurationMinutes: e.target.value })}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs shrink-0"
                            onClick={() => updateServiceArea(sa.areaId, { defaultValidityDurationMinutes: "1440" })}
                          >
                            1 Tag
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 rounded-lg">{error}</p>
        )}

        <Separator className="dark:bg-slate-800" />

        <div className="flex items-center justify-between">
          {!isNew ? (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 h-8 text-xs"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
              Löschen
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving || deleting} className="h-8">
              Abbrechen
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || deleting || !name.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 min-w-24 h-8"
            >
              {saving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <><Save className="h-3.5 w-3.5 mr-1" />{isNew ? "Erstellen" : "Speichern"}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
