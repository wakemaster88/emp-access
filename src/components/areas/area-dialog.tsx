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
import { Loader2, Trash2, Save, Link2 } from "lucide-react";

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

export function AreaDialog({ area, allAreas, annyResources = [], annyMappings = {}, open, onClose }: AreaDialogProps) {
  const router = useRouter();
  const isNew = !area;
  const [form, setForm] = useState(EMPTY);
  const [selectedAnnyResource, setSelectedAnnyResource] = useState("__none__");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      if (area) {
        setForm({
          name: area.name,
          parentId: area.parentId ? String(area.parentId) : "none",
          allowReentry: area.allowReentry,
          personLimit: area.personLimit != null ? String(area.personLimit) : "",
          showOnDashboard: area.showOnDashboard,
          openingHours: area.openingHours ?? "",
        });
        const mapped = Object.entries(annyMappings).find(
          ([name, areaId]) => areaId === area.id && annyResources.includes(name)
        );
        setSelectedAnnyResource(mapped ? mapped[0] : "__none__");
      } else {
        setForm(EMPTY);
        setSelectedAnnyResource("__none__");
      }
    }
  }, [open, area, annyMappings, annyResources]);

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
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

      if (annyResources.length > 0 && areaId) {
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

              for (const name of annyResources) {
                if (mappings[name] === areaId) delete mappings[name];
              }
              if (selectedAnnyResource !== "__none__") {
                mappings[selectedAnnyResource] = areaId;
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
        } catch { /* anny mapping update is best-effort */ }
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

  // Exclude the current area and its children from parent selection
  const parentOptions = allAreas.filter((a) => !area || a.id !== area.id);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Neue Resource anlegen" : "Resource bearbeiten"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="a-name">Name <span className="text-rose-500">*</span></Label>
            <Input
              id="a-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z.B. Haupteingang, Aquapark, VIP"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Übergeordnete Resource</Label>
            <Select value={form.parentId} onValueChange={(v) => set("parentId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Keine (Hauptresource)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Keine (Hauptresource)</SelectItem>
                {parentOptions.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-limit">Personenlimit</Label>
            <Input
              id="a-limit"
              type="number"
              min="1"
              value={form.personLimit}
              onChange={(e) => set("personLimit", e.target.value)}
              placeholder="Leer = unbegrenzt (∞)"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div>
              <p className="text-sm font-medium">Wiedereinlass</p>
              <p className="text-xs text-slate-500">Ticket kann mehrfach gescannt werden</p>
            </div>
            <Switch
              checked={form.allowReentry}
              onCheckedChange={(v) => set("allowReentry", v)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div>
              <p className="text-sm font-medium">Im Dashboard anzeigen</p>
              <p className="text-xs text-slate-500">Resource auf der Dashboard-Übersicht zeigen</p>
            </div>
            <Switch
              checked={form.showOnDashboard}
              onCheckedChange={(v) => set("showOnDashboard", v)}
            />
          </div>

          {annyResources.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-violet-500" />
                anny Ressource
              </Label>
              <Select value={selectedAnnyResource} onValueChange={setSelectedAnnyResource}>
                <SelectTrigger>
                  <SelectValue placeholder="Keine Verknüpfung" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">– Keine Verknüpfung –</SelectItem>
                  {annyResources.map((r) => {
                    const usedBy = annyMappings[r];
                    const isSelf = area && usedBy === area.id;
                    const isUsed = usedBy != null && !isSelf;
                    const usedAreaName = isUsed ? allAreas.find((a) => a.id === usedBy)?.name : null;
                    return (
                      <SelectItem key={r} value={r} disabled={isUsed}>
                        <span className="flex items-center gap-1.5">
                          {r}
                          {isUsed && usedAreaName && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">→ {usedAreaName}</Badge>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="a-hours">Öffnungszeiten</Label>
            <Input
              id="a-hours"
              value={form.openingHours}
              onChange={(e) => set("openingHours", e.target.value)}
              placeholder="z.B. Mo-Fr 09:00-18:00, Sa 10:00-16:00"
            />
          </div>

          {error && (
            <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
          )}

          <Separator className="dark:bg-slate-800" />

          <div className="flex items-center justify-between">
            {!isNew ? (
              <Button
                type="button" variant="ghost" size="sm"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                Löschen
              </Button>
            ) : <div />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving || deleting}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || deleting || !form.name.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 min-w-28"
              >
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><Save className="h-4 w-4 mr-1.5" />{isNew ? "Erstellen" : "Speichern"}</>}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
