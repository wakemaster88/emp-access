"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Trash2, Save, Settings2, Link2, Cpu } from "lucide-react";
import { ScanLockField } from "@/components/devices/edit-device-dialog";
import { descendantIds } from "@/lib/area-tree";

export interface AreaData {
  id: number;
  name: string;
  parentId: number | null;
  allowReentry: boolean;
  personLimit: number | null;
  scanLockSeconds?: number | null;
  showOnDashboard: boolean;
  openingHours: string | null;
}

/** Gerät, das an einer Ressource Einlass oder Auslass sein kann. */
export interface AreaDevice {
  id: number;
  name: string;
  accessIn: number | null;
  accessOut: number | null;
  isActive: boolean;
}

interface AreaDialogProps {
  /** `null` = neue Ressource. */
  area: AreaData | null;
  /** Bei einer neuen Ressource: vorgewählte übergeordnete Ressource. */
  presetParentId?: number | null;
  /** Reiter beim Öffnen (z. B. „devices“ aus dem Mehr-Menü). */
  initialTab?: AreaDialogTab;
  /** Direkt mit der Lösch-Rückfrage öffnen (Mehr-Menü „Löschen …“). */
  askDelete?: boolean;
  allAreas: AreaData[];
  devices?: AreaDevice[];
  annyResources?: string[];
  annyServices?: string[];
  annyMappings?: Record<string, number>;
  open: boolean;
  onClose: () => void;
  /** Nach dem Löschen (Detailseite: zurück zur Liste). Standard: Seite neu laden. */
  onDeleted?: () => void;
}

const EMPTY = {
  name: "",
  parentId: "none",
  allowReentry: false,
  personLimit: "",
  scanLockSeconds: "0",
  showOnDashboard: true,
  openingHours: "",
};

export type AreaDialogTab = "settings" | "devices" | "anny";

const sameSet = (a: Set<number | string>, b: Set<number | string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

function AnnyChecklist({
  label,
  items,
  selected,
  onToggle,
  mappings,
  areaId,
  allAreas,
}: {
  /** Name der Liste für Screenreader. */
  label: string;
  items: string[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  mappings: Record<string, number>;
  areaId: number | null;
  allAreas: AreaData[];
}) {
  if (items.length === 0) {
    return <EmptyState compact size="sm" title="Nichts gefunden." description="Bitte erst anny synchronisieren." />;
  }

  return (
    // Auswahlliste aus dem Baustein Checklist (docs/design-regeln.md, Abschnitt 16): die ganze Zeile
    // schaltet das Kästchen; anderswo verknüpfte Einträge sind gesperrt.
    <Checklist aria-label={label} maxHeight={240}>
      {items.map((name) => {
        const isSelected = selected.has(name);
        const usedBy = mappings[name];
        const isSelf = areaId != null && usedBy === areaId;
        const isUsedElsewhere = usedBy != null && !isSelf && !isSelected;
        const usedAreaName = isUsedElsewhere ? allAreas.find((a) => a.id === usedBy)?.name : null;

        return (
          <ChecklistItem
            key={name}
            checked={isSelected}
            onCheckedChange={() => onToggle(name)}
            disabled={isUsedElsewhere}
            title={name}
            trailing={isUsedElsewhere && usedAreaName ? (
              <Badge variant="secondary" className="shrink-0">{usedAreaName}</Badge>
            ) : null}
          />
        );
      })}
    </Checklist>
  );
}

/**
 * Geräte für eine Richtung (Einlass oder Auslass). Ein Gerät gehört je
 * Richtung genau einer Ressource: Anhaken holt es von seiner bisherigen
 * Ressource hierher – das steht rechts als „wechselt von …“.
 */
function DeviceChecklist({
  label,
  devices,
  selected,
  onToggle,
  currentOf,
  areaId,
  areaNames,
}: {
  label: string;
  devices: AreaDevice[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  currentOf: (d: AreaDevice) => number | null;
  areaId: number | null;
  areaNames: Map<number, string>;
}) {
  return (
    <Checklist aria-label={label} maxHeight={220}>
      {devices.map((d) => {
        const current = currentOf(d);
        const elsewhere = current != null && current !== areaId ? areaNames.get(current) ?? `#${current}` : null;
        const checked = selected.has(d.id);
        return (
          <ChecklistItem
            key={d.id}
            checked={checked}
            onCheckedChange={() => onToggle(d.id)}
            title={d.name}
            description={!d.isActive ? "Inaktiv" : undefined}
            trailing={elsewhere ? (
              <Badge variant={checked ? "warning" : "secondary"} className="shrink-0 max-w-36 truncate">
                {checked ? `wechselt von ${elsewhere}` : elsewhere}
              </Badge>
            ) : null}
          />
        );
      })}
    </Checklist>
  );
}

export function AreaDialog({
  area, presetParentId = null, initialTab = "settings", askDelete = false, allAreas, devices = [],
  annyResources = [], annyServices = [], annyMappings = {},
  open, onClose, onDeleted,
}: AreaDialogProps) {
  const router = useRouter();
  const isNew = !area;
  const [tab, setTab] = useState<AreaDialogTab>("settings");
  const [form, setForm] = useState(EMPTY);
  const [selectedAnny, setSelectedAnny] = useState<Set<string>>(new Set());
  const [initialAnny, setInitialAnny] = useState<Set<string>>(new Set());
  const [devIn, setDevIn] = useState<Set<number>>(new Set());
  const [devOut, setDevOut] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const hasAnny = annyResources.length > 0 || annyServices.length > 0;
  const hasDevices = devices.length > 0;
  const showTabs = hasAnny || hasDevices;
  const areaId = area?.id ?? null;

  const areaNames = useMemo(() => new Map(allAreas.map((a) => [a.id, a.name])), [allAreas]);

  const initialIn = useMemo(
    () => new Set(areaId == null ? [] : devices.filter((d) => d.accessIn === areaId).map((d) => d.id)),
    [devices, areaId],
  );
  const initialOut = useMemo(
    () => new Set(areaId == null ? [] : devices.filter((d) => d.accessOut === areaId).map((d) => d.id)),
    [devices, areaId],
  );

  // Ein Leser ohne Ressource prüft keine Bereiche mehr und lässt jedes gültige
  // Ticket durch (api/devices/pi/scan). Das soll niemand aus Versehen auslösen.
  const unrestricted = devices.filter((d) => {
    const wasHere = initialIn.has(d.id) || initialOut.has(d.id);
    if (!wasHere) return false;
    const nextIn = devIn.has(d.id) ? areaId : d.accessIn === areaId ? null : d.accessIn;
    const nextOut = devOut.has(d.id) ? areaId : d.accessOut === areaId ? null : d.accessOut;
    return nextIn == null && nextOut == null;
  });

  const annyCount = [...selectedAnny].filter((n) => annyResources.includes(n) || annyServices.includes(n)).length;
  const deviceCount = new Set([...devIn, ...devOut]).size;

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDelete(askDelete && !!area);
    setTab(initialTab === "devices" && !hasDevices ? "settings" : initialTab === "anny" && !hasAnny ? "settings" : initialTab);
    setDevIn(new Set(initialIn));
    setDevOut(new Set(initialOut));
    if (area) {
      setForm({
        name: area.name,
        parentId: area.parentId ? String(area.parentId) : "none",
        allowReentry: area.allowReentry,
        personLimit: area.personLimit != null ? String(area.personLimit) : "",
        scanLockSeconds: String(area.scanLockSeconds ?? 0),
        showOnDashboard: area.showOnDashboard,
        openingHours: area.openingHours ?? "",
      });
      const linked = new Set<string>();
      for (const [name, linkedArea] of Object.entries(annyMappings)) {
        if (linkedArea === area.id && (annyResources.includes(name) || annyServices.includes(name))) {
          linked.add(name);
        }
      }
      setSelectedAnny(linked);
      setInitialAnny(new Set(linked));
    } else {
      setForm({ ...EMPTY, parentId: presetParentId ? String(presetParentId) : "none" });
      setSelectedAnny(new Set());
      setInitialAnny(new Set());
    }
    // Nur beim Öffnen übernehmen – sonst überschriebe ein router.refresh() die Eingaben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, area]);

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function toggleIn(current: Set<string>, value: string): Set<string>;
  function toggleIn(current: Set<number>, value: number): Set<number>;
  function toggleIn(current: Set<string | number>, value: string | number) {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        parentId: form.parentId && form.parentId !== "none" ? form.parentId : null,
        allowReentry: form.allowReentry,
        personLimit: form.personLimit ? Number(form.personLimit) : null,
        scanLockSeconds: Number(form.scanLockSeconds) || 0,
        showOnDashboard: form.showOnDashboard,
        openingHours: form.openingHours.trim() || null,
      };
      const res = await fetch(isNew ? "/api/areas" : `/api/areas/${area!.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Speichern hat nicht geklappt. Bitte erneut versuchen.");
        return;
      }

      const savedArea = await res.json();
      const savedId: number | undefined = savedArea.id ?? area?.id;

      // Geräte und anny nur senden, wenn sich etwas geändert hat.
      const problems: string[] = [];
      if (savedId && hasDevices && (!sameSet(devIn, initialIn) || !sameSet(devOut, initialOut))) {
        const r = await fetch(`/api/areas/${savedId}/devices`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ in: [...devIn], out: [...devOut] }),
        }).catch(() => null);
        if (!r?.ok) problems.push("Geräte");
      }
      if (savedId && hasAnny && !sameSet(selectedAnny, initialAnny)) {
        const r = await fetch(`/api/areas/${savedId}/anny-links`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([...selectedAnny]),
        }).catch(() => null);
        if (!r?.ok) problems.push("anny-Verknüpfungen");
      }

      router.refresh();
      if (problems.length > 0) {
        // Die Ressource ist gespeichert; nur der Rest fehlt. Dialog offen lassen.
        setError(`Ressource gespeichert, aber ${problems.join(" und ")} nicht. Bitte erneut speichern.`);
        return;
      }
      onClose();
    } catch {
      setError("Keine Verbindung. Bitte erneut versuchen.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!area) return;
    const res = await fetch(`/api/areas/${area.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // ConfirmStep zeigt die Meldung am Schritt (z. B. „noch von 12 gültigen Tickets verwendet“).
      throw new Error(data.error ?? "Löschen hat nicht geklappt.");
    }
    onClose();
    if (onDeleted) onDeleted();
    else router.refresh();
  }

  // Kein Ring: die Ressource selbst und ihre Unterressourcen scheiden als Elternteil aus.
  const blocked = area ? descendantIds(allAreas, area.id) : new Set<number>();
  const parentOptions = allAreas
    .filter((a) => !blocked.has(a.id))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const presetParentName = isNew && presetParentId ? areaNames.get(presetParentId) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-base">
            {isNew ? (presetParentName ? `Neue Unterressource in ${presetParentName}` : "Neue Ressource") : area.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isNew
              ? "Ein Zugangsbereich, den Tickets, Services und Abos freigeben."
              : "Regeln, Geräte und Verknüpfungen dieser Ressource."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as AreaDialogTab)} className="gap-4">
          {/* Glas-Kapsel, in der Ebene automatisch getönt (docs/design-regeln.md, Abschnitt 18); Symbole erst ab sm, damit alles auf das Handy passt. */}
          {showTabs && (
            <TabsList className="w-full">
              <TabsTrigger value="settings" className="px-2.5">
                <Settings2 className="size-3.5 max-sm:hidden" />
                Regeln
              </TabsTrigger>
              {hasDevices && (
                <TabsTrigger value="devices" className="px-2.5">
                  <Cpu className="size-3.5 max-sm:hidden" />
                  Geräte{deviceCount > 0 && ` (${deviceCount})`}
                </TabsTrigger>
              )}
              {hasAnny && (
                <TabsTrigger value="anny" className="px-2.5">
                  <Link2 className="size-3.5 max-sm:hidden" />
                  anny{annyCount > 0 && ` (${annyCount})`}
                </TabsTrigger>
              )}
            </TabsList>
          )}

          {/* Ohne Tab-Leiste kein Tab-Panel: keine Panel-Rolle, kein Verweis auf einen fehlenden Reiter, kein zusätzlicher Tab-Halt. */}
          <TabsContent
            value="settings"
            className="space-y-3"
            {...(showTabs ? {} : { role: undefined, tabIndex: undefined, "aria-labelledby": undefined })}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
              <div className="space-y-1">
                <Label htmlFor="a-name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="a-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="z. B. Strandbad, Seilbahn A"
                  required
                  autoFocus={isNew}
                  className="max-sm:h-11"
                />
              </div>
              <div className="space-y-1">
                <Label>Gehört zu</Label>
                <Select value={form.parentId} onValueChange={(v) => set("parentId", v)}>
                  <SelectTrigger className="w-full max-sm:data-[size=default]:h-11">
                    <SelectValue placeholder="Keiner (Hauptressource)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keiner (Hauptressource)</SelectItem>
                    {parentOptions.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-label pt-1">Einlass</p>

            {/* Schalterzeilen als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (docs/design-regeln.md, Abschnitt 18). */}
            <label className="glass-tile flex min-h-11 cursor-pointer items-center justify-between gap-3 p-2.5">
              <span>
                <span className="block text-[13px] font-medium">Wiedereinlass</span>
                <span className="block text-[11px] text-muted-foreground">
                  {form.allowReentry
                    ? "Ein Ticket kommt mehrmals herein, nach einem Scan am Auslass."
                    : "Ein Ticket kommt genau einmal herein."}
                </span>
              </span>
              <Switch checked={form.allowReentry} onCheckedChange={(v) => set("allowReentry", v)} />
            </label>

            <ScanLockField
              value={form.scanLockSeconds}
              onChange={(v) => set("scanLockSeconds", v)}
              title="Sperrzeit für diese Ressource"
              description="Dasselbe Ticket kommt erst nach dieser Zeit wieder herein – an allen Eingängen der Ressource und auch dann, wenn zwischendurch am Ausgang gescannt wurde. Mitarbeiter sind ausgenommen."
            />

            <div className="space-y-1">
              <Label htmlFor="a-limit">Personenlimit</Label>
              <Input
                id="a-limit"
                type="number"
                inputMode="numeric"
                min="1"
                value={form.personLimit}
                onChange={(e) => set("personLimit", e.target.value)}
                placeholder="Ohne Limit"
                className="max-sm:h-11"
              />
              <p className="text-[11px] text-muted-foreground">Höchstens so viele Personen gleichzeitig. Leer lassen für kein Limit.</p>
            </div>

            <p className="text-label pt-1">Anzeige</p>

            <label className="glass-tile flex min-h-11 cursor-pointer items-center justify-between gap-3 p-2.5">
              <span>
                <span className="block text-[13px] font-medium">Im Dashboard zeigen</span>
                <span className="block text-[11px] text-muted-foreground">Belegung und Öffnungszeit auf der Übersicht.</span>
              </span>
              <Switch checked={form.showOnDashboard} onCheckedChange={(v) => set("showOnDashboard", v)} />
            </label>

            <div className="space-y-1">
              <Label htmlFor="a-hours">Öffnungszeiten</Label>
              <Input
                id="a-hours"
                value={form.openingHours}
                onChange={(e) => set("openingHours", e.target.value)}
                placeholder="z. B. Mo–Fr 09:00–18:00"
                className="max-sm:h-11"
              />
            </div>
          </TabsContent>

          {hasDevices && (
            <TabsContent value="devices" className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Ein Gerät gehört je Richtung zu genau einer Ressource. Hakst du eines an, das woanders steht, wechselt es hierher.
              </p>
              {unrestricted.length > 0 && (
                <Notice
                  tone="warning"
                  compact
                  title={`${unrestricted.map((d) => d.name).join(", ")} ${unrestricted.length === 1 ? "hat" : "haben"} danach keine Ressource`}
                >
                  Ein Gerät ohne Ressource lässt jedes gültige Ticket durch. Ordne es lieber einer anderen Ressource zu.
                </Notice>
              )}
              <div className="space-y-1.5">
                <p className="text-label">Einlass</p>
                <DeviceChecklist
                  label="Geräte am Einlass"
                  devices={devices}
                  selected={devIn}
                  onToggle={(id) => setDevIn((s) => toggleIn(s, id))}
                  currentOf={(d) => d.accessIn}
                  areaId={areaId}
                  areaNames={areaNames}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-label">Auslass</p>
                <DeviceChecklist
                  label="Geräte am Auslass"
                  devices={devices}
                  selected={devOut}
                  onToggle={(id) => setDevOut((s) => toggleIn(s, id))}
                  currentOf={(d) => d.accessOut}
                  areaId={areaId}
                  areaNames={areaNames}
                />
              </div>
            </TabsContent>
          )}

          {hasAnny && (
            <TabsContent value="anny" className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-label">anny Ressourcen</p>
                <p className="text-[11px] text-muted-foreground">Ihre Verfügbarkeit erscheint im Dashboard.</p>
                <AnnyChecklist
                  label="anny Ressourcen"
                  items={annyResources}
                  selected={selectedAnny}
                  onToggle={(n) => setSelectedAnny((s) => toggleIn(s, n))}
                  mappings={annyMappings}
                  areaId={areaId}
                  allAreas={allAreas}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-label">anny Services</p>
                <p className="text-[11px] text-muted-foreground">Gebuchte Tickets landen beim Sync in dieser Ressource.</p>
                <AnnyChecklist
                  label="anny Services"
                  items={annyServices}
                  selected={selectedAnny}
                  onToggle={(n) => setSelectedAnny((s) => toggleIn(s, n))}
                  mappings={annyMappings}
                  areaId={areaId}
                  allAreas={allAreas}
                />
              </div>
            </TabsContent>
          )}
        </Tabs>

        {error && <Notice tone="danger" compact title={error} />}

        <Separator />

        {/* Löschen als Schritt im selben Dialog, keine zweite Ebene (docs/design-regeln.md, Abschnitt 18).
            Hängen noch gültige Tickets an der Ressource, steht die Meldung des Servers am Schritt. */}
        {confirmDelete && area ? (
          <ConfirmStep
            title={`„${area.name}“ wirklich löschen?`}
            description="Unterressourcen werden zu Hauptressourcen. Geräte dieser Ressource lassen danach nur noch Tickets ohne Ressource durch – ordne sie vorher neu zu."
            confirmLabel="Endgültig löschen"
            icon={Trash2}
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        ) : (
          // Handy: Tasten volle Breite, Primärtaste oben, „Löschen“ zuunterst; ab sm „Löschen“ links (`DialogFooter start`, Abschnitt 16).
          <DialogFooter
            start={!isNew ? (
              <Button
                type="button" variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 max-sm:h-11"
              >
                <Trash2 className="h-4 w-4" />
                Löschen
              </Button>
            ) : null}
          >
            <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
              Abbrechen
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="min-w-24 max-sm:h-11"
            >
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><Save className="h-4 w-4" />{isNew ? "Anlegen" : "Speichern"}</>}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
