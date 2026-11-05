"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { Loader2, Trash2, Save, Settings2, Link2, Package, Check } from "lucide-react";
import { ScanLockField } from "@/components/devices/edit-device-dialog";
import { cn } from "@/lib/utils";

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

interface AreaDialogProps {
  area: AreaData | null;
  allAreas: AreaData[];
  annyResources?: string[];
  annyServices?: string[];
  annyMappings?: Record<string, number>;
  open: boolean;
  onClose: () => void;
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

type TabId = "settings" | "resources" | "services";

function CheckList({
  items,
  selected,
  onToggle,
  mappings,
  areaId,
  allAreas,
  emptyTitle,
  emptyDescription,
}: {
  items: string[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  mappings: Record<string, number>;
  areaId: number | null;
  allAreas: AreaData[];
  emptyTitle: string;
  emptyDescription?: string;
}) {
  if (items.length === 0) {
    return <EmptyState compact title={emptyTitle} description={emptyDescription} />;
  }

  return (
    // Auswahlliste als Glas-Kachel; in der Ebene getönt (docs/design-regeln.md, Abschnitt 18).
    // Zeilen: Auswahl bg-primary/10, Darüberfahren bg-glass-tile (Abschnitt 17); Kästchen wie der Baustein Checkbox.
    <div className="glass-tile max-h-[320px] overflow-y-auto scrollbar-thin space-y-0.5 p-1">
      {items.map((name) => {
        const isSelected = selected.has(name);
        const usedBy = mappings[name];
        const isSelf = areaId != null && usedBy === areaId;
        const isUsedElsewhere = usedBy != null && !isSelf && !isSelected;
        const usedAreaName = isUsedElsewhere ? allAreas.find((a) => a.id === usedBy)?.name : null;

        return (
          <button
            key={name}
            type="button"
            onClick={() => !isUsedElsewhere && onToggle(name)}
            disabled={isUsedElsewhere}
            className={cn(
              "w-full flex items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors max-sm:min-h-11",
              isSelected
                ? "bg-primary/10"
                : "hover:bg-glass-tile",
              isUsedElsewhere && "opacity-40 cursor-not-allowed"
            )}
          >
            <div className={cn(
              "size-[18px] rounded-[6px] border flex items-center justify-center shrink-0 transition-colors",
              isSelected
                ? "bg-primary border-primary text-primary-foreground"
                : "border-input bg-field"
            )}>
              {isSelected && <Check className="size-3.5" strokeWidth={3} />}
            </div>
            <span className="text-xs text-foreground/80 truncate flex-1">{name}</span>
            {isUsedElsewhere && usedAreaName && (
              <Badge variant="secondary" className="text-[11px] px-1.5 py-0 shrink-0">→ {usedAreaName}</Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AreaDialog({
  area, allAreas,
  annyResources = [], annyServices = [], annyMappings = {},
  open, onClose,
}: AreaDialogProps) {
  const router = useRouter();
  const isNew = !area;
  const [tab, setTab] = useState<TabId>("settings");
  const [form, setForm] = useState(EMPTY);
  const [selectedAnny, setSelectedAnny] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const hasAnny = annyResources.length > 0 || annyServices.length > 0;
  const showTabs = hasAnny && !isNew;
  const allAnnyItems = [...annyResources, ...annyServices];

  const selectedResCount = annyResources.filter((r) => selectedAnny.has(r)).length;
  const selectedSvcCount = annyServices.filter((s) => selectedAnny.has(s)).length;

  useEffect(() => {
    if (open) {
      setError("");
      setTab("settings");
      setConfirmDelete(false);
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
        for (const [name, areaId] of Object.entries(annyMappings)) {
          if (areaId === area.id && (annyResources.includes(name) || annyServices.includes(name))) {
            linked.add(name);
          }
        }
        setSelectedAnny(linked);
      } else {
        setForm(EMPTY);
        setSelectedAnny(new Set());
      }
    }
  }, [open, area, annyMappings, annyResources, annyServices]);

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function toggleAnny(name: string) {
    setSelectedAnny((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
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
      const url = isNew ? "/api/areas" : `/api/areas/${area!.id}`;
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

      const savedArea = await res.json();
      const areaId = savedArea.id ?? area?.id;

      if (hasAnny && areaId) {
        try {
          await fetch(`/api/areas/${areaId}/anny-links`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([...selectedAnny]),
          });
        } catch { /* best-effort */ }
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
    if (!area) return;
    setDeleting(true);
    try {
      await fetch(`/api/areas/${area.id}`, { method: "DELETE" });
      onClose();
      router.refresh();
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  const parentOptions = allAreas.filter((a) => !area || a.id !== area.id);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-base">{isNew ? "Neue Resource anlegen" : "Resource bearbeiten"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-4">
          {/* Glas-Kapsel, in der Ebene automatisch getönt (docs/design-regeln.md, Abschnitt 18); schmale Reiter, Symbole erst ab sm, damit alle drei auf das Handy passen. */}
          {showTabs && (
            <TabsList className="w-full">
              <TabsTrigger value="settings" className="px-2.5">
                <Settings2 className="size-3.5 max-sm:hidden" />
                Einstellungen
              </TabsTrigger>
              <TabsTrigger value="resources" className="px-2.5">
                <Link2 className="size-3.5 max-sm:hidden" />
                Ressourcen{selectedResCount > 0 && ` (${selectedResCount})`}
              </TabsTrigger>
              <TabsTrigger value="services" className="px-2.5">
                <Package className="size-3.5 max-sm:hidden" />
                Services{selectedSvcCount > 0 && ` (${selectedSvcCount})`}
              </TabsTrigger>
            </TabsList>
          )}

          {/* Ohne Tab-Leiste kein Tab-Panel: keine Panel-Rolle, kein Verweis auf einen fehlenden Reiter, kein zusätzlicher Tab-Halt. */}
          <TabsContent
            value="settings"
            className="space-y-3"
            {...(showTabs ? {} : { role: undefined, tabIndex: undefined, "aria-labelledby": undefined })}
          >
            <div className="space-y-1">
              <Label htmlFor="a-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="a-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="z.B. Haupteingang, Aquapark, VIP"
                required
                autoFocus
                className="max-sm:h-11"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
              <div className="space-y-1">
                <Label>Übergeordnete Resource</Label>
                <Select value={form.parentId} onValueChange={(v) => set("parentId", v)}>
                  <SelectTrigger className="w-full max-sm:data-[size=default]:h-11">
                    <SelectValue placeholder="Keine" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine (Hauptresource)</SelectItem>
                    {parentOptions.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-limit">Personenlimit</Label>
                <Input
                  id="a-limit"
                  type="number"
                  min="1"
                  value={form.personLimit}
                  onChange={(e) => set("personLimit", e.target.value)}
                  placeholder="∞"
                  className="max-sm:h-11"
                />
              </div>
            </div>

            {/* Schalterzeilen als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (docs/design-regeln.md, Abschnitt 18). */}
            <div className="glass-tile flex items-center justify-between gap-3 p-2.5">
              <div>
                <p className="text-xs font-medium">Wiedereinlass</p>
                <p className="text-[11px] text-muted-foreground">Mehrfach scannen</p>
              </div>
              <Switch checked={form.allowReentry} onCheckedChange={(v) => set("allowReentry", v)} />
            </div>

            <ScanLockField
              value={form.scanLockSeconds}
              onChange={(v) => set("scanLockSeconds", v)}
              title="Sperrzeit für diese Resource"
              description="Dasselbe Ticket kommt erst nach dieser Zeit wieder herein – an allen Eingängen der Resource und auch dann, wenn zwischendurch am Ausgang gescannt wurde. Mitarbeiter sind ausgenommen."
            />

            <div className="glass-tile flex items-center justify-between gap-3 p-2.5">
              <div>
                <p className="text-xs font-medium">Im Dashboard anzeigen</p>
                <p className="text-[11px] text-muted-foreground">Auf der Übersicht zeigen</p>
              </div>
              <Switch checked={form.showOnDashboard} onCheckedChange={(v) => set("showOnDashboard", v)} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="a-hours">Öffnungszeiten</Label>
              <Input
                id="a-hours"
                value={form.openingHours}
                onChange={(e) => set("openingHours", e.target.value)}
                placeholder="z.B. Mo-Fr 09:00-18:00"
                className="max-sm:h-11"
              />
            </div>
          </TabsContent>

          <TabsContent value="resources" className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Verknüpfe anny Ressourcen mit dieser Resource. Die Verfügbarkeiten werden im Dashboard angezeigt.
            </p>
            <CheckList
              items={annyResources}
              selected={selectedAnny}
              onToggle={toggleAnny}
              mappings={annyMappings}
              areaId={area?.id ?? null}
              allAreas={allAreas}
              emptyTitle="Keine anny Ressourcen gefunden."
              emptyDescription="Bitte erst synchronisieren."
            />
          </TabsContent>

          <TabsContent value="services" className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Verknüpfe anny Services mit dieser Resource. Tickets werden beim Sync automatisch zugewiesen.
            </p>
            <CheckList
              items={annyServices}
              selected={selectedAnny}
              onToggle={toggleAnny}
              mappings={annyMappings}
              areaId={area?.id ?? null}
              allAreas={allAreas}
              emptyTitle="Keine anny Services gefunden."
              emptyDescription="Bitte erst synchronisieren."
            />
          </TabsContent>
        </Tabs>

        {error && (
          <Notice tone="danger" compact title={error} />
        )}

        {/* Löschen als Schritt im selben Dialog statt Browser-Rückfrage, keine zweite Ebene (docs/design-regeln.md, Abschnitt 18). */}
        {confirmDelete && area && (
          <Notice
            tone="danger"
            compact
            title={`Resource "${area.name}" wirklich löschen?`}
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

        {/* Handy: Tasten volle Breite, Primärtaste oben (docs/design-regeln.md, Abschnitt 16).
            Tasten 36 px wie in der Lösch-Rückfrage (Abschnitt 5: 34 bis 44 px); „Löschen“ in voller Nebentextfarbe (Kontrast 4,5:1). */}
        <DialogFooter className="sm:items-center sm:justify-between">
          {!isNew ? (
            <Button
              type="button" variant="ghost"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting || saving}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 max-sm:h-11"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Löschen
            </Button>
          ) : <div className="hidden sm:block" />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving || deleting} className="max-sm:h-11">
              Abbrechen
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || deleting || !form.name.trim()}
              className="min-w-24 max-sm:h-11"
            >
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><Save className="h-4 w-4" />{isNew ? "Erstellen" : "Speichern"}</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
