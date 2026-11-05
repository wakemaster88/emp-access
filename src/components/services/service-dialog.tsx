"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, Loader2, Trash2, Save, Settings2, Link2, MapPin, ScanLine, ClipboardCheck } from "lucide-react";

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
  allowManualCheckin?: boolean;
  requiresPhoto?: boolean;
  requiresRfid?: boolean;
  /** Plaetze pro Slot, die EMP selbst verwaltet. NULL = ANNY ist maßgeblich. */
  slotCapacity?: number | null;
  /** Hauptressource: Wird beim Verkauf als `Ticket.accessAreaId` verwendet
   *  und steuert, an welchem Gate die Zeitgueltigkeit (DURATION) startet
   *  bzw. die Hauptressourcen-Logik im Pi-Scanner greift. NULL = keine
   *  eindeutige Hauptressource (Fallback: erste ServiceArea nach id). */
  mainAccessAreaId?: number | null;
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

function AnnyChecklist({
  label,
  items,
  selected,
  onToggle,
  emptyTitle,
  emptyDescription,
}: {
  /** Name der Liste für Screenreader. */
  label: string;
  items: { key: string; label: string }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  emptyTitle: string;
  emptyDescription?: string;
}) {
  if (items.length === 0) {
    return <EmptyState compact title={emptyTitle} description={emptyDescription} />;
  }

  return (
    // Auswahlliste aus dem Baustein Checklist (docs/design-regeln.md, Abschnitt 16): die ganze Zeile schaltet das Kästchen.
    <Checklist aria-label={label} maxHeight={320}>
      {items.map((item) => (
        <ChecklistItem
          key={item.key}
          checked={selected.has(item.key)}
          onCheckedChange={() => onToggle(item.key)}
          title={item.label}
        />
      ))}
    </Checklist>
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
  const [allowManualCheckin, setAllowManualCheckin] = useState(true);
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [requiresRfid, setRequiresRfid] = useState(false);
  const [slotCapacity, setSlotCapacity] = useState("");
  // "none" = keine Hauptressource gesetzt; sonst stringified areaId
  const [mainAccessAreaId, setMainAccessAreaId] = useState<string>("none");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const hasAnny = annyServices.length > 0 || annyResources.length > 0;

  useEffect(() => {
    if (open) {
      setError("");
      setTab("settings");
      setConfirmDelete(false);
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
        setAllowManualCheckin(service.allowManualCheckin !== false);
        setRequiresPhoto(service.requiresPhoto ?? false);
        setRequiresRfid(service.requiresRfid ?? false);
        setSlotCapacity(service.slotCapacity != null ? String(service.slotCapacity) : "");
        setMainAccessAreaId(service.mainAccessAreaId != null ? String(service.mainAccessAreaId) : "none");
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
        setAllowManualCheckin(true);
        setRequiresPhoto(false);
        setRequiresRfid(false);
        setSlotCapacity("");
        setMainAccessAreaId("none");
      }
    }
  }, [open, service, initialServiceAreas]);

  // Wenn die Hauptressource aus den ServiceAreas entfernt wird, setzen wir
  // die Auswahl zurueck. Andernfalls wuerde der Backend-Validator den
  // Save-Request mit "Hauptressource muss Teil der ServiceAreas sein"
  // zurueckweisen.
  useEffect(() => {
    if (mainAccessAreaId === "none") return;
    if (!serviceAreas.some((sa) => String(sa.areaId) === mainAccessAreaId)) {
      setMainAccessAreaId("none");
    }
  }, [serviceAreas, mainAccessAreaId]);

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
        allowManualCheckin,
        requiresPhoto,
        requiresRfid,
        slotCapacity: slotCapacity.trim() === "" ? null : Number(slotCapacity),
        mainAccessAreaId: mainAccessAreaId === "none" ? null : Number(mainAccessAreaId),
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
        try {
          const data = await res.json();
          setError(data.error ?? `Fehler ${res.status}`);
        } catch {
          setError(`Server-Fehler (${res.status})`);
        }
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(`Netzwerkfehler: ${err instanceof Error ? err.message : "Unbekannt"}`);

    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!service) return;
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
  const mainAreaHelp =
    "Bei mehreren Resourcen muss eine als Hauptressource definiert werden. Sie steuert, an welchem Gate die Zeitgültigkeit (DURATION) startet und wie der Pi-Scanner Reentry behandelt - alle anderen sind dann Transit/Nebenressourcen.";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-base">{isNew ? "Neuen Service anlegen" : "Service bearbeiten"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-4">
          {/* Glas-Kapsel, in der Ebene automatisch getönt (docs/design-regeln.md, Abschnitt 18); schmale Reiter, Symbole erst ab sm, damit alle Reiter auf das Handy passen. */}
          <TabsList className="w-full">
            <TabsTrigger value="settings" className="px-2.5">
              <Settings2 className="size-3.5 max-sm:hidden" />
              Einstellungen
            </TabsTrigger>
            {hasAnny && (
              <TabsTrigger value="anny" className="px-2.5">
                <Link2 className="size-3.5 max-sm:hidden" />
                anny{selectedAnny.size > 0 && ` (${selectedAnny.size})`}
              </TabsTrigger>
            )}
            <TabsTrigger value="areas" className="px-2.5">
              <MapPin className="size-3.5 max-sm:hidden" />
              Resourcen{serviceAreas.length > 0 && ` (${serviceAreas.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="svc-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="svc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Strandbad Tageskarte, Ferienkurs"
                required
                autoFocus
                className="max-sm:h-11"
              />
            </div>

            {/* Gruppen im Dialog als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (docs/design-regeln.md, Abschnitt 18). */}
            <div className="glass-tile divide-y divide-border">
              <div className="flex items-center justify-between gap-3 p-2.5">
                <div>
                  <p className="text-xs font-medium text-foreground/80">Wiedereinlass</p>
                  <p className="text-[11px] text-muted-foreground">Bei Scan an Ausgang: Ticket wieder gültig setzen</p>
                </div>
                <Switch checked={allowReentry} onCheckedChange={setAllowReentry} />
              </div>
              <div className="flex items-center justify-between gap-3 p-2.5">
                <div>
                  <p className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                    <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground/70" />
                    Manuelles Einchecken
                  </p>
                  <p className="text-[11px] text-muted-foreground">Einchecken-Button im Check-in Monitor anzeigen</p>
                </div>
                <Switch checked={allowManualCheckin} onCheckedChange={setAllowManualCheckin} />
              </div>
              <div className="flex items-center justify-between gap-3 p-2.5">
                <div>
                  <p className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5 text-muted-foreground/70" />
                    Foto verpflichtend
                  </p>
                  <p className="text-[11px] text-muted-foreground">Kamera öffnet automatisch wenn kein Bild vorhanden</p>
                </div>
                <Switch checked={requiresPhoto} onCheckedChange={setRequiresPhoto} />
              </div>
              <div className="flex items-center justify-between gap-3 p-2.5">
                <div>
                  <p className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                    <ScanLine className="h-3.5 w-3.5 text-muted-foreground/70" />
                    RFID verpflichtend
                  </p>
                  <p className="text-[11px] text-muted-foreground">Warnung im Dashboard wenn kein RFID-Band verknüpft</p>
                </div>
                <Switch checked={requiresRfid} onCheckedChange={setRequiresRfid} />
              </div>
            </div>

            <div className="glass-tile p-2.5 space-y-2">
              <p className="text-label">Standard-Gültigkeit für neue Tickets</p>
              <div className="space-y-1.5">
                <Label>Gültigkeitstyp</Label>
                <Select value={defaultValidityType} onValueChange={setDefaultValidityType}>
                  <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue placeholder="Kein Standard" /></SelectTrigger>
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
                    <Label>Gültig ab</Label>
                    <Input type="date" className="max-sm:h-11" value={defaultStartDate} onChange={(e) => setDefaultStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Gültig bis</Label>
                    <Input type="date" className="max-sm:h-11" value={defaultEndDate} onChange={(e) => setDefaultEndDate(e.target.value)} />
                  </div>
                </div>
              )}
              {defaultValidityType === "TIME_SLOT" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Slot von</Label>
                    <Input type="time" className="max-sm:h-11" value={defaultSlotStart} onChange={(e) => setDefaultSlotStart(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Slot bis</Label>
                    <Input type="time" className="max-sm:h-11" value={defaultSlotEnd} onChange={(e) => setDefaultSlotEnd(e.target.value)} />
                  </div>
                </div>
              )}
              {defaultValidityType === "DURATION" && (
                <div className="space-y-1">
                  <Label>Dauer (Minuten)</Label>
                  <div className="flex gap-2 items-center">
                    <Input type="number" min={1} className="flex-1 max-sm:h-11" placeholder="z.B. 120" value={defaultValidityDurationMinutes} onChange={(e) => setDefaultValidityDurationMinutes(e.target.value)} />
                    <Button type="button" variant="outline" size="sm" className="h-9 text-xs shrink-0 max-sm:h-11" onClick={() => setDefaultValidityDurationMinutes("1440")}>
                      1 Tag
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">1 Tag = 1440 Minuten</p>
                </div>
              )}
            </div>

            {service && (
              <div className="glass-tile p-2.5 space-y-1.5">
                <p className="text-label">Zusammenfassung</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAnny.size > 0 && (
                    <Badge variant="neutral" className="tabular-nums">
                      {selectedAnny.size} anny {selectedAnny.size === 1 ? "Verknüpfung" : "Verknüpfungen"}
                    </Badge>
                  )}
                  {serviceAreas.length > 0 && (
                    <Badge variant="neutral" className="tabular-nums">
                      {serviceAreas.length} {serviceAreas.length === 1 ? "Resource" : "Resourcen"}
                    </Badge>
                  )}
                  {selectedAnny.size === 0 && serviceAreas.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">Keine Verknüpfungen</span>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="anny" className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Wähle anny Services und Ressourcen, die diesem Service zugeordnet werden. Tickets mit diesen Namen werden beim Sync automatisch verknüpft.
            </p>
            <AnnyChecklist
              label="anny Verknüpfungen"
              items={annyItems}
              selected={selectedAnny}
              onToggle={toggleAnny}
              emptyTitle="Keine anny Einträge gefunden."
              emptyDescription="Bitte erst synchronisieren."
            />
            {selectedAnny.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="neutral" className="tabular-nums">{selectedAnny.size} ausgewählt</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setSelectedAnny(new Set())}
                  className="text-muted-foreground hover:text-destructive max-sm:h-11"
                >
                  Alle abwählen
                </Button>
              </div>
            )}

            <div className="glass-tile p-2.5 space-y-1.5">
              <Label htmlFor="svc-slot-capacity">
                Plätze pro Slot selbst verwalten
              </Label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Nur nötig, wenn sich mehrere Services in anny <em>eine</em> Ressource teilen. anny zählt Buchungen
                dann pro Ressource statt pro Service, wodurch jede Buchung die freien Plätze aller beteiligten
                Services senkt. Mit einem Wert hier rechnet EMP die Belegung selbst – nur aus den Buchungen
                dieses Services. Leer lassen = anny ist maßgeblich.
              </p>
              <Input
                id="svc-slot-capacity"
                type="number"
                min={1}
                inputMode="numeric"
                value={slotCapacity}
                onChange={(e) => setSlotCapacity(e.target.value)}
                placeholder="z.B. 15 – leer = anny"
                className="max-sm:h-11"
              />
            </div>
          </TabsContent>

          <TabsContent value="areas" className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Resourcen hinzufügen und pro Resource die Gültigkeit für Service-Tickets einstellen. Tickets erscheinen im Dashboard in allen zugeordneten Resourcen.
            </p>
            {serviceAreas.length > 1 && (
              <div className="space-y-2">
                {/* Warnung nur, solange sie etwas fordert; ist eine Hauptressource gewählt, wird sie zur Feldbeschriftung mit Hilfetext. */}
                {mainAccessAreaId === "none" ? (
                  <Notice tone="warning" compact title="Hauptressource">
                    {mainAreaHelp}
                  </Notice>
                ) : (
                  <Label htmlFor="svc-main-area">Hauptressource</Label>
                )}
                <Select
                  value={mainAccessAreaId}
                  onValueChange={(v) => setMainAccessAreaId(v)}
                >
                  <SelectTrigger id="svc-main-area" className="w-full max-sm:data-[size=default]:h-11">
                    <SelectValue placeholder="Keine Hauptressource (legacy: erste in Liste)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine (Fallback: erste Resource)</SelectItem>
                    {serviceAreas.map((sa) => (
                      <SelectItem key={sa.areaId} value={String(sa.areaId)}>
                        {sa.areaName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {mainAccessAreaId !== "none" && (
                  <p className="text-[11px] text-muted-foreground">{mainAreaHelp}</p>
                )}
              </div>
            )}
            {availableAreasToAdd.length > 0 && (
              <div className="flex gap-2 items-center">
                <Select
                  value=""
                  onValueChange={(v) => { const id = Number(v); if (id) addServiceArea(id); }}
                >
                  <SelectTrigger className="flex-1 max-sm:data-[size=default]:h-11">
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
              <EmptyState
                compact
                icon={MapPin}
                title="Noch keine Resourcen zugeordnet."
                description="Resource oben hinzufügen."
              />
            ) : (
              // Kein eigener Scrollbereich: der Dialog scrollt als Ganzes, sonst schneidet die innere Liste Kacheln ab.
              <div className="space-y-3">
                {serviceAreas.map((sa) => (
                  <div
                    key={sa.areaId}
                    className="glass-tile p-2.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground/80">{sa.areaName}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 max-sm:size-11"
                        onClick={() => removeServiceArea(sa.areaId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground">Gültigkeit für diese Resource</Label>
                      <Select
                        value={sa.defaultValidityType}
                        onValueChange={(v) => updateServiceArea(sa.areaId, { defaultValidityType: v })}
                      >
                        <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
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
                        <div className="space-y-1">
                          <Label>Gültig ab</Label>
                          <Input
                            type="date"
                            className="max-sm:h-11"
                            value={sa.defaultStartDate}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultStartDate: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Gültig bis</Label>
                          <Input
                            type="date"
                            className="max-sm:h-11"
                            value={sa.defaultEndDate}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultEndDate: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                    {sa.defaultValidityType === "TIME_SLOT" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label>Slot von</Label>
                          <Input
                            type="time"
                            className="max-sm:h-11"
                            value={sa.defaultSlotStart}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultSlotStart: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Slot bis</Label>
                          <Input
                            type="time"
                            className="max-sm:h-11"
                            value={sa.defaultSlotEnd}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultSlotEnd: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                    {sa.defaultValidityType === "DURATION" && (
                      <div className="space-y-1">
                        <Label>Dauer (Minuten)</Label>
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            min={1}
                            className="flex-1 max-sm:h-11"
                            placeholder="z.B. 120"
                            value={sa.defaultValidityDurationMinutes}
                            onChange={(e) => updateServiceArea(sa.areaId, { defaultValidityDurationMinutes: e.target.value })}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 text-xs shrink-0 max-sm:h-11"
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
          </TabsContent>
        </Tabs>

        {error && (
          <Notice tone="danger" compact title={error} />
        )}

        {/* Löschen als Schritt im selben Dialog statt Browser-Rückfrage, keine zweite Ebene (docs/design-regeln.md, Abschnitt 18). */}
        {confirmDelete && service && (
          <Notice
            tone="danger"
            compact
            title={`Service "${service.name}" wirklich löschen?`}
            action={
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="max-sm:h-11"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Endgültig löschen
              </Button>
            }
          />
        )}

        <Separator />

        {/* Handy: Tasten volle Breite, Primärtaste oben, „Löschen“ zuunterst; ab sm „Löschen“ links (`DialogFooter start`, docs/design-regeln.md, Abschnitt 16).
            Tasten 36 px wie in der Lösch-Rückfrage (Abschnitt 5: 34 bis 44 px); „Löschen“ in voller Nebentextfarbe (Kontrast 4,5:1). */}
        <DialogFooter
          start={!isNew ? (
            <Button
              type="button" variant="ghost"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting || saving}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 max-sm:h-11"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Löschen
            </Button>
          ) : null}
        >
          <Button type="button" variant="outline" onClick={onClose} disabled={saving || deleting} className="max-sm:h-11">
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || deleting || !name.trim()}
            className="min-w-24 max-sm:h-11"
          >
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <><Save className="h-4 w-4" />{isNew ? "Erstellen" : "Speichern"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
