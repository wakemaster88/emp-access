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
  Check, Users, Search, MapPin, Clock, UserPlus, ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface VereinData {
  id: number;
  name: string;
  description: string | null;
}

export interface TicketRef {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  vereinId: number | null;
  /** Aufgelöste Area-Namen dieses Tickets (eigene + ticketAreas). */
  areaNames: string[];
  /** Gültigkeit des Tickets selbst – wird als Restriktion für Bulk-Zutritt genutzt. */
  validityType: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  startDate: string | null;
  endDate: string | null;
  validityDurationMinutes: number | null;
}

interface VereinDialogProps {
  verein: VereinData | null;
  initialAccessTicketIds: number[];
  initialMemberIds: number[];
  allTickets: TicketRef[];
  open: boolean;
  onClose: () => void;
}

type TabId = "settings" | "accessTickets" | "members";

function ticketDisplayName(t: TicketRef): string {
  const personName = [t.firstName, t.lastName].filter(Boolean).join(" ");
  return personName || t.name;
}

function formatDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * Kompakte Beschreibung der Ticket-eigenen Gültigkeit – wird im Dialog/Tabelle
 * als Hinweis auf die effektive Restriktion eines Bulk-Zutritts angezeigt.
 */
export function formatTicketValidity(t: Pick<TicketRef,
  "validityType" | "slotStart" | "slotEnd" | "startDate" | "endDate" | "validityDurationMinutes"
>): string {
  const vType = t.validityType ?? "DATE_RANGE";
  if (vType === "TIME_SLOT" && t.slotStart && t.slotEnd) {
    return `Täglich ${t.slotStart}–${t.slotEnd}`;
  }
  if (vType === "DURATION" && t.validityDurationMinutes) {
    const h = Math.floor(t.validityDurationMinutes / 60);
    const m = t.validityDurationMinutes % 60;
    const dur = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
    return `${dur} ab erstem Scan`;
  }
  const from = formatDate(t.startDate);
  const to = formatDate(t.endDate);
  if (from && to) return `${from}–${to}`;
  if (from) return `ab ${from}`;
  if (to) return `bis ${to}`;
  return "Unbegrenzt";
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
      <div className="max-h-[260px] overflow-y-auto space-y-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-1">
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

export function VereinDialog({
  verein, initialAccessTicketIds, initialMemberIds,
  allTickets,
  open, onClose,
}: VereinDialogProps) {
  const router = useRouter();
  const isNew = !verein;
  const [tab, setTab] = useState<TabId>("settings");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAccessTickets, setSelectedAccessTickets] = useState<Set<string>>(new Set());
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Quick-Add: Mitglied direkt aus dem Dialog anlegen (Ticket ohne Tickettyp).
  const [qaFirst, setQaFirst] = useState("");
  const [qaLast, setQaLast] = useState("");
  const [qaCode, setQaCode] = useState("");
  const [qaAdding, setQaAdding] = useState(false);
  const [qaError, setQaError] = useState("");
  const [qaSuccess, setQaSuccess] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setTab("settings");
      if (verein) {
        setName(verein.name);
        setDescription(verein.description ?? "");
        setSelectedAccessTickets(new Set(initialAccessTicketIds.map(String)));
        setSelectedMembers(new Set(initialMemberIds.map(String)));
      } else {
        setName(""); setDescription("");
        setSelectedAccessTickets(new Set());
        setSelectedMembers(new Set());
      }
      setQaFirst(""); setQaLast(""); setQaCode(""); setQaError(""); setQaSuccess("");
    }
  }, [open, verein, initialAccessTicketIds, initialMemberIds]);

  function toggleAccessTicket(key: string) {
    setSelectedAccessTickets((prev) => {
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

  async function handleQuickAddMember() {
    if (!verein) return;
    const first = qaFirst.trim();
    const last = qaLast.trim();
    if (!first && !last) {
      setQaError("Vor- oder Nachname angeben");
      return;
    }
    setQaAdding(true);
    setQaError("");
    setQaSuccess("");
    try {
      const fullName = [first, last].filter(Boolean).join(" ") || "Mitglied";
      const code = qaCode.trim();
      const payload: Record<string, unknown> = {
        name: fullName,
        firstName: first || undefined,
        lastName: last || undefined,
        status: "VALID",
        vereinId: verein.id,
      };
      if (code) {
        payload.barcode = code;
        payload.qrCode = code;
        payload.rfidCode = code;
      }
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setQaError(typeof data?.error === "string" ? data.error : `Server-Fehler (${res.status})`);
        return;
      }
      const created = await res.json().catch(() => null);
      if (created?.id) {
        // Direkt als Mitglied vormerken; finale Persistenz erfolgt beim Speichern.
        setSelectedMembers((prev) => new Set(prev).add(String(created.id)));
      }
      setQaFirst(""); setQaLast(""); setQaCode("");
      setQaSuccess(`${fullName} hinzugefügt`);
      router.refresh();
    } catch (err) {
      setQaError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
    } finally {
      setQaAdding(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        accessTicketIds: [...selectedAccessTickets].map(Number),
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

  const accessTicketItems = useMemo(
    () => allTickets.map((t) => {
      const subParts: string[] = [];
      if (t.ticketTypeName) subParts.push(t.ticketTypeName);
      if (t.areaNames.length > 0) subParts.push(`→ ${t.areaNames.join(", ")}`);
      subParts.push(formatTicketValidity(t));
      return {
        key: String(t.id),
        label: ticketDisplayName(t),
        sublabel: subParts.join(" · "),
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

  const accessCount = selectedAccessTickets.size;

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
                  {[...selectedAccessTickets].map((idStr) => {
                    const t = allTickets.find((x) => String(x.id) === idStr);
                    if (!t) return null;
                    return (
                      <div key={idStr} className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 truncate min-w-0">
                          <TicketIcon className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className="truncate">{ticketDisplayName(t)}</span>
                          {t.areaNames.length > 0 && (
                            <span className="text-[10px] text-slate-400 inline-flex items-center gap-0.5 shrink-0">
                              <MapPin className="h-2.5 w-2.5" />
                              {t.areaNames.join(", ")}
                            </span>
                          )}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                          <Clock className="h-2.5 w-2.5" />
                          {formatTicketValidity(t)}
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
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Wähle <strong>Zutritts-Tickets</strong>. Mitglieder erben die Areas dieser Tickets beim Scan –
              die zeitliche Restriktion (Datum, Tageszeit, Dauer) ergibt sich direkt aus dem jeweiligen Ticket.
            </p>
            <CheckList
              items={accessTicketItems}
              selected={selectedAccessTickets}
              onToggle={toggleAccessTicket}
              emptyText="Keine Tickets vorhanden."
              searchable
            />
            {accessCount > 0 && (
              <button type="button" onClick={() => setSelectedAccessTickets(new Set())}
                      className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors">
                Alle abwählen
              </button>
            )}
          </div>
        )}

        {tab === "members" && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">
              Wähle Tickets, die diesem Verein angehören. Tickets, die bereits einem anderen Verein zugeordnet sind, werden hier verschoben.
            </p>

            {!isNew ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-2.5 space-y-2 bg-slate-50/40 dark:bg-slate-900/30">
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 inline-flex items-center gap-1.5">
                  <UserPlus className="h-3 w-3 text-slate-400" />
                  Mitglied ohne Tickettyp anlegen
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <Input
                    value={qaFirst}
                    onChange={(e) => setQaFirst(e.target.value)}
                    placeholder="Vorname"
                    className="h-8 text-xs"
                    disabled={qaAdding}
                  />
                  <Input
                    value={qaLast}
                    onChange={(e) => setQaLast(e.target.value)}
                    placeholder="Nachname"
                    className="h-8 text-xs"
                    disabled={qaAdding}
                  />
                </div>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <ScanLine className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                    <Input
                      value={qaCode}
                      onChange={(e) => setQaCode(e.target.value)}
                      placeholder="RFID / Barcode (optional)"
                      className="h-8 text-xs font-mono pl-7"
                      disabled={qaAdding}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleQuickAddMember}
                    disabled={qaAdding || (!qaFirst.trim() && !qaLast.trim())}
                    className="h-8 bg-violet-600 hover:bg-violet-700 text-xs"
                  >
                    {qaAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Anlegen"}
                  </Button>
                </div>
                {qaError && (
                  <p className="text-[10px] text-rose-600">{qaError}</p>
                )}
                {qaSuccess && !qaError && (
                  <p className="text-[10px] text-emerald-600 inline-flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    {qaSuccess} – nicht erneut anlegen.
                  </p>
                )}
                <p className="text-[10px] text-slate-400 leading-snug">
                  Ohne Tickettyp/Areas. Zutritt kommt ausschließlich über die Vereins-Zutritts-Tickets im Tab „Tickets“.
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 italic">
                Verein erst speichern, danach können Mitglieder direkt hier angelegt werden.
              </p>
            )}

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
