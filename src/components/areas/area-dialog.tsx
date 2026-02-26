"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Save, Settings2, Link2, Package, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AreaData {
  id: number;
  name: string;
  parentId: number | null;
  allowReentry: boolean;
  personLimit: number | null;
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
  emptyText,
}: {
  items: string[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  mappings: Record<string, number>;
  areaId: number | null;
  allAreas: AreaData[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="text-[11px] text-slate-400 py-4 text-center">{emptyText}</p>;
  }

  return (
    <div className="max-h-[320px] overflow-y-auto space-y-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-1">
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
              "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              isSelected
                ? "bg-violet-50 dark:bg-violet-900/20"
                : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
              isUsedElsewhere && "opacity-40 cursor-not-allowed"
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
            <span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1">{name}</span>
            {isUsedElsewhere && usedAreaName && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">→ {usedAreaName}</Badge>
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
  const [error, setError] = useState("");

  const hasAnny = annyResources.length > 0 || annyServices.length > 0;
  const allAnnyItems = [...annyResources, ...annyServices];

  const selectedResCount = annyResources.filter((r) => selectedAnny.has(r)).length;
  const selectedSvcCount = annyServices.filter((s) => selectedAnny.has(s)).length;

  useEffect(() => {
    if (open) {
      setError("");
      setTab("settings");
      if (area) {
        setForm({
          name: area.name,
          parentId: area.parentId ? String(area.parentId) : "none",
          allowReentry: area.allowReentry,
          personLimit: area.personLimit != null ? String(area.personLimit) : "",
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
          const cfgRes = await fetch("/api/settings/integrations");
          if (cfgRes.ok) {
            const configs = await cfgRes.json();
            const annyConfig = Array.isArray(configs)
              ? configs.find((c: { provider: string }) => c.provider === "ANNY")
              : null;
            if (annyConfig) {
              let extra: Record<string, unknown> = {};
              try { if (annyConfig.extraConfig) extra = JSON.parse(annyConfig.extraConfig); } catch { /* ignore */ }
              const mappings = (extra.mappings as Record<string, number>) || {};

              for (const name of allAnnyItems) {
                if (mappings[name] === areaId) delete mappings[name];
              }
              for (const name of selectedAnny) {
                mappings[name] = areaId;
              }

              extra.mappings = mappings;
              await fetch("/api/settings/integrations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  provider: "ANNY",
                  token: annyConfig.token,
                  baseUrl: annyConfig.baseUrl || "",
                  extraConfig: JSON.stringify(extra),
                }),
              });
            }
          }
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
    if (!area || !confirm(`Resource "${area.name}" wirklich löschen?`)) return;
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
          <DialogTitle className="text-base">{isNew ? "Neue Resource anlegen" : "Resource bearbeiten"}</DialogTitle>
        </DialogHeader>

        {hasAnny && !isNew && (
          <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            <button type="button" onClick={() => setTab("settings")} className={tabClass(tab === "settings")}>
              <Settings2 className="h-3 w-3" />
              Einstellungen
            </button>
            <button type="button" onClick={() => setTab("resources")} className={tabClass(tab === "resources")}>
              <Link2 className="h-3 w-3" />
              Ressourcen{selectedResCount > 0 && ` (${selectedResCount})`}
            </button>
            <button type="button" onClick={() => setTab("services")} className={tabClass(tab === "services")}>
              <Package className="h-3 w-3" />
              Services{selectedSvcCount > 0 && ` (${selectedSvcCount})`}
            </button>
          </div>
        )}

        {tab === "settings" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="a-name" className="text-xs">Name <span className="text-rose-500">*</span></Label>
              <Input
                id="a-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="z.B. Haupteingang, Aquapark, VIP"
                required
                autoFocus
                className="h-9"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Übergeordnete Resource</Label>
                <Select value={form.parentId} onValueChange={(v) => set("parentId", v)}>
                  <SelectTrigger className="h-9 text-xs">
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
                <Label htmlFor="a-limit" className="text-xs">Personenlimit</Label>
                <Input
                  id="a-limit"
                  type="number"
                  min="1"
                  value={form.personLimit}
                  onChange={(e) => set("personLimit", e.target.value)}
                  placeholder="∞"
                  className="h-9"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <div>
                <p className="text-xs font-medium">Wiedereinlass</p>
                <p className="text-[11px] text-slate-500">Mehrfach scannen</p>
              </div>
              <Switch checked={form.allowReentry} onCheckedChange={(v) => set("allowReentry", v)} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <div>
                <p className="text-xs font-medium">Im Dashboard anzeigen</p>
                <p className="text-[11px] text-slate-500">Auf der Übersicht zeigen</p>
              </div>
              <Switch checked={form.showOnDashboard} onCheckedChange={(v) => set("showOnDashboard", v)} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="a-hours" className="text-xs">Öffnungszeiten</Label>
              <Input
                id="a-hours"
                value={form.openingHours}
                onChange={(e) => set("openingHours", e.target.value)}
                placeholder="z.B. Mo-Fr 09:00-18:00"
                className="h-9"
              />
            </div>
          </div>
        )}

        {tab === "resources" && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Verknüpfe anny Ressourcen mit dieser Resource. Die Verfügbarkeiten werden im Dashboard angezeigt.
            </p>
            <CheckList
              items={annyResources}
              selected={selectedAnny}
              onToggle={toggleAnny}
              mappings={annyMappings}
              areaId={area?.id ?? null}
              allAreas={allAreas}
              emptyText="Keine anny Ressourcen gefunden. Bitte erst synchronisieren."
            />
          </div>
        )}

        {tab === "services" && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Verknüpfe anny Services mit dieser Resource. Tickets werden beim Sync automatisch zugewiesen.
            </p>
            <CheckList
              items={annyServices}
              selected={selectedAnny}
              onToggle={toggleAnny}
              mappings={annyMappings}
              areaId={area?.id ?? null}
              allAreas={allAreas}
              emptyText="Keine anny Services gefunden. Bitte erst synchronisieren."
            />
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
              disabled={saving || deleting || !form.name.trim()}
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
