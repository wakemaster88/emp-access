"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Save, Settings2, MapPin, Check, Users, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VereinData {
  id: number;
  name: string;
  description: string | null;
}

interface AreaRef {
  id: number;
  name: string;
}

interface TicketRef {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  vereinId: number | null;
}

interface VereinDialogProps {
  verein: VereinData | null;
  initialAreaIds: number[];
  initialMemberIds: number[];
  areas: AreaRef[];
  allTickets: TicketRef[];
  open: boolean;
  onClose: () => void;
}

type TabId = "settings" | "areas" | "members";

function CheckList({
  items,
  selected,
  onToggle,
  emptyText,
  searchable,
}: {
  items: { key: string; label: string; sublabel?: string; disabled?: boolean }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  emptyText: string;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = searchable && query
    ? items.filter((i) =>
        `${i.label} ${i.sublabel ?? ""}`.toLowerCase().includes(query.toLowerCase())
      )
    : items;

  if (items.length === 0) {
    return <p className="text-[11px] text-slate-400 py-4 text-center">{emptyText}</p>;
  }

  return (
    <div className="space-y-2">
      {searchable && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Suchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}
      <div className="max-h-[320px] overflow-y-auto space-y-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-1">
        {filtered.map(({ key, label, sublabel, disabled }) => {
          const isSelected = selected.has(key);
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(key)}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                disabled && "opacity-50 cursor-not-allowed",
                !disabled && isSelected
                  ? "bg-violet-50 dark:bg-violet-900/20"
                  : !disabled && "hover:bg-slate-50 dark:hover:bg-slate-800/50"
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
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 dark:text-slate-300 truncate">{label}</p>
                {sublabel && (
                  <p className="text-[10px] text-slate-400 truncate">{sublabel}</p>
                )}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-[11px] text-slate-400 py-4 text-center">Keine Treffer</p>
        )}
      </div>
    </div>
  );
}

export function VereinDialog({
  verein, initialAreaIds, initialMemberIds,
  areas, allTickets,
  open, onClose,
}: VereinDialogProps) {
  const router = useRouter();
  const isNew = !verein;
  const [tab, setTab] = useState<TabId>("settings");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set());
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setTab("settings");
      if (verein) {
        setName(verein.name);
        setDescription(verein.description ?? "");
        setSelectedAreas(new Set(initialAreaIds.map(String)));
        setSelectedMembers(new Set(initialMemberIds.map(String)));
      } else {
        setName("");
        setDescription("");
        setSelectedAreas(new Set());
        setSelectedMembers(new Set());
      }
    }
  }, [open, verein, initialAreaIds, initialMemberIds]);

  function toggleArea(key: string) {
    setSelectedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleMember(key: string) {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        areaIds: [...selectedAreas].map(Number),
        memberTicketIds: [...selectedMembers].map(Number),
      };
      const url = isNew ? "/api/vereine" : `/api/vereine/${verein!.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Server-Fehler (${res.status})`);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!verein || !confirm(`Verein "${verein.name}" wirklich löschen? Mitglieds-Tickets bleiben erhalten, verlieren aber den Vereins-Bulk-Zutritt.`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/vereine/${verein.id}`, { method: "DELETE" });
      onClose();
      router.refresh();
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  const areaItems = useMemo(
    () => areas.map((a) => ({ key: String(a.id), label: a.name })),
    [areas]
  );

  const memberItems = useMemo(
    () =>
      allTickets.map((t) => {
        const personName = [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
        const otherVerein = t.vereinId && verein && t.vereinId !== verein.id;
        return {
          key: String(t.id),
          label: personName,
          sublabel: [t.ticketTypeName, otherVerein ? "(in anderem Verein)" : null]
            .filter(Boolean)
            .join(" · ") || undefined,
        };
      }),
    [allTickets, verein]
  );

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
          <DialogTitle className="text-base">{isNew ? "Neuen Verein anlegen" : "Verein bearbeiten"}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          <button type="button" onClick={() => setTab("settings")} className={tabClass(tab === "settings")}>
            <Settings2 className="h-3 w-3" />
            Einstellungen
          </button>
          <button type="button" onClick={() => setTab("areas")} className={tabClass(tab === "areas")}>
            <MapPin className="h-3 w-3" />
            Resourcen{selectedAreas.size > 0 && ` (${selectedAreas.size})`}
          </button>
          <button type="button" onClick={() => setTab("members")} className={tabClass(tab === "members")}>
            <Users className="h-3 w-3" />
            Mitglieder{selectedMembers.size > 0 && ` (${selectedMembers.size})`}
          </button>
        </div>

        {tab === "settings" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="v-name" className="text-xs">Name <span className="text-rose-500">*</span></Label>
              <Input
                id="v-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Eisenbahnverein Musterstadt"
                required
                autoFocus
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-desc" className="text-xs">Beschreibung</Label>
              <Input
                id="v-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional, z. B. Ansprechpartner / Notiz"
                className="h-9"
              />
            </div>

            {verein && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-1">
                <p className="text-[11px] text-slate-500">Zusammenfassung</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAreas.size > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {selectedAreas.size} {selectedAreas.size === 1 ? "Resource" : "Resourcen"}
                    </Badge>
                  )}
                  {selectedMembers.size > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {selectedMembers.size} {selectedMembers.size === 1 ? "Mitglied" : "Mitglieder"}
                    </Badge>
                  )}
                  {selectedAreas.size === 0 && selectedMembers.size === 0 && (
                    <span className="text-[10px] text-slate-400">Noch keine Verknüpfungen</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "areas" && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Wähle die Resourcen, zu denen <strong>alle Mitglieder</strong> dieses Vereins automatisch Zutritt bekommen sollen (z. B. Bahnmiete).
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

        {tab === "members" && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Wähle Tickets, die diesem Verein angehören. Tickets, die bereits einem anderen Verein zugeordnet sind, werden hier verschoben.
            </p>
            <CheckList
              items={memberItems}
              selected={selectedMembers}
              onToggle={toggleMember}
              emptyText="Keine Tickets vorhanden."
              searchable
            />
            {selectedMembers.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{selectedMembers.size} ausgewählt</Badge>
                <button
                  type="button"
                  onClick={() => setSelectedMembers(new Set())}
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
