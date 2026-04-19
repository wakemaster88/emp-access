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
import {
  Loader2, Trash2, Save, Settings2, Ticket as TicketIcon,
  Check, Users, Search, MapPin, Clock, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface VereinData {
  id: number;
  name: string;
  description: string | null;
}

interface TicketRef {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  vereinId: number | null;
  /** Aufgelöste Area-Namen dieses Tickets (eigene + ticketAreas). */
  areaNames: string[];
}

export interface VereinAccessTicketConfig {
  ticketId: number;
  /** Bitmaske bit0=Mo … bit6=So. 127 = alle Tage. */
  daysOfWeek: number;
  slotStart: string | null;
  slotEnd: string | null;
}

interface VereinDialogProps {
  verein: VereinData | null;
  initialAccessTickets: VereinAccessTicketConfig[];
  initialMemberIds: number[];
  allTickets: TicketRef[];
  open: boolean;
  onClose: () => void;
}

type TabId = "settings" | "accessTickets" | "members";

const WEEKDAYS: { bit: number; short: string; long: string }[] = [
  { bit: 0, short: "Mo", long: "Montag" },
  { bit: 1, short: "Di", long: "Dienstag" },
  { bit: 2, short: "Mi", long: "Mittwoch" },
  { bit: 3, short: "Do", long: "Donnerstag" },
  { bit: 4, short: "Fr", long: "Freitag" },
  { bit: 5, short: "Sa", long: "Samstag" },
  { bit: 6, short: "So", long: "Sonntag" },
];
const ALL_DAYS = 127;

function ticketDisplayName(t: TicketRef): string {
  const personName = [t.firstName, t.lastName].filter(Boolean).join(" ");
  return personName || t.name;
}

/** Kompakte Beschreibung der Wochentag/Slot-Restriktion ("Alle Tage", "So", "Mo–Fr 09:00–17:00"). */
export function formatAccessWindow(cfg: { daysOfWeek: number; slotStart: string | null; slotEnd: string | null }): string {
  let dayPart = "";
  if (cfg.daysOfWeek !== ALL_DAYS) {
    const selected = WEEKDAYS.filter((d) => (cfg.daysOfWeek >> d.bit) & 1);
    if (selected.length === 0) dayPart = "Nie";
    else if (selected.length === 7) dayPart = "";
    else if (selected.length === 5 && cfg.daysOfWeek === 0b0011111) dayPart = "Mo–Fr";
    else if (selected.length === 2 && cfg.daysOfWeek === 0b1100000) dayPart = "Sa+So";
    else dayPart = selected.map((d) => d.short).join(", ");
  }
  const slotPart = cfg.slotStart && cfg.slotEnd ? `${cfg.slotStart}–${cfg.slotEnd}` : "";
  if (!dayPart && !slotPart) return "Alle Tage";
  return [dayPart, slotPart].filter(Boolean).join(" ");
}

function CheckList({
  items, selected, onToggle, emptyText, searchable,
}: {
  items: { key: string; label: string; sublabel?: string; disabled?: boolean }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  emptyText: string;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = searchable && query
    ? items.filter((i) => `${i.label} ${i.sublabel ?? ""}`.toLowerCase().includes(query.toLowerCase()))
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
            type="text" placeholder="Suchen…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}
      <div className="max-h-[220px] overflow-y-auto space-y-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-1">
        {filtered.map(({ key, label, sublabel, disabled }) => {
          const isSelected = selected.has(key);
          return (
            <button
              key={key} type="button" disabled={disabled}
              onClick={() => onToggle(key)}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                disabled && "opacity-50 cursor-not-allowed",
                !disabled && isSelected ? "bg-violet-50 dark:bg-violet-900/20" : !disabled && "hover:bg-slate-50 dark:hover:bg-slate-800/50"
              )}
            >
              <div className={cn(
                "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                isSelected ? "bg-violet-500 border-violet-500" : "border-slate-300 dark:border-slate-600"
              )}>
                {isSelected && <Check className="h-3 w-3 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 dark:text-slate-300 truncate">{label}</p>
                {sublabel && <p className="text-[10px] text-slate-400 truncate">{sublabel}</p>}
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

/** Editor für daysOfWeek + Slot pro Verein↔Ticket-Verbindung. */
function AccessWindowEditor({
  cfg, ticket, onChange,
}: {
  cfg: VereinAccessTicketConfig;
  ticket: TicketRef;
  onChange: (next: VereinAccessTicketConfig) => void;
}) {
  function toggleDay(bit: number) {
    const next = cfg.daysOfWeek ^ (1 << bit);
    onChange({ ...cfg, daysOfWeek: next });
  }
  function setSlot(start: string, end: string) {
    onChange({
      ...cfg,
      slotStart: start.trim() || null,
      slotEnd: end.trim() || null,
    });
  }

  const isAllDays = cfg.daysOfWeek === ALL_DAYS;
  const hasSlot = !!(cfg.slotStart && cfg.slotEnd);

  return (
    <div className="rounded-md border border-violet-200 dark:border-violet-900/40 bg-violet-50/30 dark:bg-violet-950/10 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
          <TicketIcon className="h-3 w-3 text-violet-500 shrink-0" />
          {ticketDisplayName(ticket)}
          {ticket.areaNames.length > 0 && (
            <span className="text-[10px] text-slate-400 inline-flex items-center gap-0.5">
              <MapPin className="h-2.5 w-2.5" />
              {ticket.areaNames.join(", ")}
            </span>
          )}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
            <Calendar className="h-2.5 w-2.5" />
            Wochentage
          </span>
          <button
            type="button"
            onClick={() => onChange({ ...cfg, daysOfWeek: ALL_DAYS })}
            className={cn("text-[10px] hover:underline", isAllDays ? "text-slate-300 cursor-default" : "text-indigo-600 dark:text-indigo-400")}
            disabled={isAllDays}
          >
            Alle
          </button>
        </div>
        <div className="flex gap-0.5">
          {WEEKDAYS.map((d) => {
            const active = ((cfg.daysOfWeek >> d.bit) & 1) === 1;
            return (
              <button
                key={d.bit}
                type="button"
                onClick={() => toggleDay(d.bit)}
                title={d.long}
                className={cn(
                  "flex-1 h-6 text-[10px] font-medium rounded transition-colors",
                  active
                    ? "bg-violet-500 text-white hover:bg-violet-600"
                    : "bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 hover:border-violet-300"
                )}
              >
                {d.short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            Tageszeit (optional)
          </span>
          {hasSlot && (
            <button
              type="button"
              onClick={() => setSlot("", "")}
              className="text-[10px] text-slate-400 hover:text-rose-500"
            >
              Ganztags
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="time"
            value={cfg.slotStart ?? ""}
            onChange={(e) => setSlot(e.target.value, cfg.slotEnd ?? "")}
            className="flex-1 h-7 px-2 text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-[10px] text-slate-400">bis</span>
          <input
            type="time"
            value={cfg.slotEnd ?? ""}
            onChange={(e) => setSlot(cfg.slotStart ?? "", e.target.value)}
            className="flex-1 h-7 px-2 text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        {(cfg.slotStart && !cfg.slotEnd) || (!cfg.slotStart && cfg.slotEnd) ? (
          <p className="text-[10px] text-amber-600">Beide Zeiten setzen oder beide leer lassen.</p>
        ) : null}
      </div>
    </div>
  );
}

export function VereinDialog({
  verein, initialAccessTickets, initialMemberIds,
  allTickets,
  open, onClose,
}: VereinDialogProps) {
  const router = useRouter();
  const isNew = !verein;
  const [tab, setTab] = useState<TabId>("settings");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // ticketId → Konfig. Vorhandensein = ausgewählt.
  const [accessConfigs, setAccessConfigs] = useState<Map<number, VereinAccessTicketConfig>>(new Map());
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
        setAccessConfigs(new Map(initialAccessTickets.map((c) => [c.ticketId, { ...c }])));
        setSelectedMembers(new Set(initialMemberIds.map(String)));
      } else {
        setName(""); setDescription("");
        setAccessConfigs(new Map());
        setSelectedMembers(new Set());
      }
    }
  }, [open, verein, initialAccessTickets, initialMemberIds]);

  function toggleAccessTicket(idStr: string) {
    const id = Number(idStr);
    setAccessConfigs((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { ticketId: id, daysOfWeek: ALL_DAYS, slotStart: null, slotEnd: null });
      return next;
    });
  }
  function updateAccessConfig(id: number, cfg: VereinAccessTicketConfig) {
    setAccessConfigs((prev) => {
      const next = new Map(prev);
      next.set(id, cfg);
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
      const accessTickets = [...accessConfigs.values()].map((c) => ({
        ticketId: c.ticketId,
        daysOfWeek: c.daysOfWeek,
        slotStart: c.slotStart || null,
        slotEnd: c.slotEnd || null,
      }));
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        accessTickets,
        memberTicketIds: [...selectedMembers].map(Number),
      };
      const url = isNew ? "/api/vereine" : `/api/vereine/${verein!.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(typeof data?.error === "string" ? data.error : `Server-Fehler (${res.status})`);
        return;
      }
      onClose(); router.refresh();
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
      onClose(); router.refresh();
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  const selectedAccessTicketIds = useMemo(
    () => new Set([...accessConfigs.keys()].map(String)),
    [accessConfigs]
  );

  const accessTicketItems = useMemo(
    () => allTickets.map((t) => {
      const subParts: string[] = [];
      if (t.ticketTypeName) subParts.push(t.ticketTypeName);
      if (t.areaNames.length > 0) subParts.push(`→ ${t.areaNames.join(", ")}`);
      return {
        key: String(t.id),
        label: ticketDisplayName(t),
        sublabel: subParts.join(" · ") || undefined,
      };
    }),
    [allTickets]
  );

  const memberItems = useMemo(
    () => allTickets.map((t) => {
      const otherVerein = t.vereinId && verein && t.vereinId !== verein.id;
      return {
        key: String(t.id),
        label: ticketDisplayName(t),
        sublabel: [t.ticketTypeName, otherVerein ? "(in anderem Verein)" : null]
          .filter(Boolean).join(" · ") || undefined,
      };
    }),
    [allTickets, verein]
  );

  const tabClass = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
      active ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
             : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
    }`;

  const accessCount = accessConfigs.size;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-base">{isNew ? "Neuen Verein anlegen" : "Verein bearbeiten"}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          <button type="button" onClick={() => setTab("settings")} className={tabClass(tab === "settings")}>
            <Settings2 className="h-3 w-3" /> Einstellungen
          </button>
          <button type="button" onClick={() => setTab("accessTickets")} className={tabClass(tab === "accessTickets")}>
            <TicketIcon className="h-3 w-3" />
            Tickets{accessCount > 0 && ` (${accessCount})`}
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
              <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="z. B. Eisenbahnverein Musterstadt" required autoFocus className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-desc" className="text-xs">Beschreibung</Label>
              <Input id="v-desc" value={description} onChange={(e) => setDescription(e.target.value)}
                     placeholder="Optional, z. B. Ansprechpartner / Notiz" className="h-9" />
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <TicketIcon className="h-3 w-3 text-slate-400" />
                  Bulk-Zutritt über {accessCount === 1 ? "1 Ticket" : `${accessCount} Tickets`}
                </p>
                <button type="button" onClick={() => setTab("accessTickets")}
                        className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline">
                  Bearbeiten
                </button>
              </div>
              {accessCount > 0 ? (
                <div className="space-y-1">
                  {[...accessConfigs.values()].map((cfg) => {
                    const t = allTickets.find((x) => x.id === cfg.ticketId);
                    if (!t) return null;
                    const window = formatAccessWindow(cfg);
                    return (
                      <div key={cfg.ticketId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 truncate">
                          <TicketIcon className="h-3 w-3 text-slate-400 shrink-0" />
                          {ticketDisplayName(t)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                          <Clock className="h-2.5 w-2.5" />
                          {window}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Noch keine Zutritts-Tickets zugeordnet. Im Tab „Tickets“ ein Ticket (z. B. „Bahnmiete“) auswählen.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <Users className="h-3 w-3 text-slate-400" />
                  {selectedMembers.size === 1 ? "1 Mitglied" : `${selectedMembers.size} Mitglieder`}
                </p>
                <button type="button" onClick={() => setTab("members")}
                        className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline">
                  Bearbeiten
                </button>
              </div>
              {selectedMembers.size === 0 && (
                <p className="text-[11px] text-slate-400">Noch keine Mitglieds-Tickets zugeordnet.</p>
              )}
            </div>
          </div>
        )}

        {tab === "accessTickets" && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">
              Wähle <strong>Zutritts-Tickets</strong>. Mitglieder erben die Areas dieser Tickets beim Scan – optional eingeschränkt auf Wochentage und Uhrzeit (z. B. „Bahnmiete nur So 10–12“).
            </p>
            <CheckList
              items={accessTicketItems}
              selected={selectedAccessTicketIds}
              onToggle={toggleAccessTicket}
              emptyText="Keine Tickets vorhanden."
              searchable
            />

            {accessConfigs.size > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Restriktionen</p>
                <div className="space-y-2 max-h-[260px] overflow-y-auto">
                  {[...accessConfigs.values()].map((cfg) => {
                    const t = allTickets.find((x) => x.id === cfg.ticketId);
                    if (!t) return null;
                    return (
                      <AccessWindowEditor
                        key={cfg.ticketId}
                        cfg={cfg}
                        ticket={t}
                        onChange={(next) => updateAccessConfig(cfg.ticketId, next)}
                      />
                    );
                  })}
                </div>
                <button type="button" onClick={() => setAccessConfigs(new Map())}
                        className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors">
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
                <button type="button" onClick={() => setSelectedMembers(new Set())}
                        className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors">
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
            <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={deleting || saving}
                    className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 h-8 text-xs">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
              Löschen
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving || deleting} className="h-8">
              Abbrechen
            </Button>
            <Button type="button" size="sm" onClick={handleSave}
                    disabled={saving || deleting || !name.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 min-w-24 h-8">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <><Save className="h-3.5 w-3.5 mr-1" />{isNew ? "Erstellen" : "Speichern"}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
