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
import { Loader2, Trash2, Save, Settings2, Link2, MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ServiceData {
  id: number;
  name: string;
  annyNames: string | null;
}

interface AreaRef {
  id: number;
  name: string;
}

interface ServiceDialogProps {
  service: ServiceData | null;
  initialAreaIds: number[];
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

export function ServiceDialog({
  service, initialAreaIds,
  areas, annyServices, annyResources,
  open, onClose,
}: ServiceDialogProps) {
  const router = useRouter();
  const isNew = !service;
  const [tab, setTab] = useState<TabId>("settings");
  const [name, setName] = useState("");
  const [selectedAnny, setSelectedAnny] = useState<Set<string>>(new Set());
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set());
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
        setSelectedAreas(new Set(initialAreaIds.map(String)));
      } else {
        setName("");
        setSelectedAnny(new Set());
        setSelectedAreas(new Set());
      }
    }
  }, [open, service, initialAreaIds]);

  function toggleAnny(key: string) {
    setSelectedAnny((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleArea(key: string) {
    setSelectedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        annyNames: [...selectedAnny],
        areaIds: [...selectedAreas].map(Number),
      };
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
            Resourcen{selectedAreas.size > 0 && ` (${selectedAreas.size})`}
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

            {service && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-1">
                <p className="text-[11px] text-slate-500">Zusammenfassung</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAnny.size > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {selectedAnny.size} anny {selectedAnny.size === 1 ? "Verknüpfung" : "Verknüpfungen"}
                    </Badge>
                  )}
                  {selectedAreas.size > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {selectedAreas.size} {selectedAreas.size === 1 ? "Resource" : "Resourcen"}
                    </Badge>
                  )}
                  {selectedAnny.size === 0 && selectedAreas.size === 0 && (
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
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Wähle die Resourcen, zu denen dieser Service Zugang gewährt. Service-Tickets erscheinen im Dashboard in allen ausgewählten Resourcen.
            </p>
            <CheckList
              items={areaItems}
              selected={selectedAreas}
              onToggle={toggleArea}
              emptyText="Keine Resourcen vorhanden."
            />
            {selectedAreas.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{selectedAreas.size} ausgewählt</Badge>
                <button
                  type="button"
                  onClick={() => setSelectedAreas(new Set())}
                  className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors"
                >
                  Alle abwählen
                </button>
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
