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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
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
    return <EmptyState compact title={emptyText} />;
  }

  // Auswahlliste als Glas-Kachel; in der Ebene getönt (docs/design-regeln.md, Abschnitt 18).
  // Zeilen: Auswahl bg-primary/10, Darüberfahren bg-glass-tile (Abschnitt 17); Kästchen wie der Baustein Checkbox.
  return (
    <div className="space-y-2">
      {searchable && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 z-10 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
          <Input
            type="text" placeholder="Suchen…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 pl-8 sm:h-9"
          />
        </div>
      )}
      <div className="glass-tile max-h-[260px] overflow-y-auto overscroll-contain scrollbar-thin space-y-0.5 p-1">
        {filtered.map(({ key, label, sublabel, disabled }) => {
          const isSelected = selected.has(key);
          return (
            <button
              key={key} type="button" disabled={disabled}
              onClick={() => onToggle(key)}
              className={cn(
                "w-full flex min-h-11 items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left transition-colors sm:min-h-9",
                disabled && "opacity-50 cursor-not-allowed",
                !disabled && isSelected ? "bg-primary/10" : !disabled && "hover:bg-glass-tile"
              )}
            >
              <div className={cn(
                "size-[18px] rounded-[6px] border flex items-center justify-center shrink-0 transition-colors",
                isSelected ? "bg-primary border-primary text-primary-foreground" : "border-input bg-field"
              )}>
                {isSelected && <Check className="size-3.5" strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-foreground truncate">{label}</p>
                {sublabel && <p className="text-[11px] text-muted-foreground truncate">{sublabel}</p>}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <EmptyState compact icon={Search} title="Keine Treffer" />
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
  // Rückfrage zum Löschen als Schritt im selben Dialog (Abschnitt 18), kein Browser-Dialog.
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      setConfirmDelete(false);
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
    if (!verein) return;
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

  const accessCount = selectedAccessTickets.size;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Neuen Verein anlegen" : "Verein bearbeiten"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-4">
          {/* Kapsel ohne eigene Klassen, in der Ebene getönt (Abschnitt 18). Symbole erst ab sm, damit alles in eine Zeile passt. */}
          <TabsList className="w-full">
            <TabsTrigger value="settings" className="px-2.5 sm:px-3.5">
              <Settings2 className="hidden size-3.5 sm:block" /> Einstellungen
            </TabsTrigger>
            <TabsTrigger value="accessTickets" className="px-2.5 sm:px-3.5">
              <TicketIcon className="hidden size-3.5 sm:block" />
              Tickets{accessCount > 0 && ` (${accessCount})`}
            </TabsTrigger>
            <TabsTrigger value="members" className="px-2.5 sm:px-3.5">
              <Users className="hidden size-3.5 sm:block" />
              Mitglieder{selectedMembers.size > 0 && ` (${selectedMembers.size})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-name" className="text-[13px]">Name <span className="text-destructive">*</span></Label>
              <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="z. B. Eisenbahnverein Musterstadt" required autoFocus className="h-11 sm:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-desc" className="text-[13px]">Beschreibung</Label>
              <Input id="v-desc" value={description} onChange={(e) => setDescription(e.target.value)}
                     placeholder="Optional, z. B. Ansprechpartner / Notiz" className="h-11 sm:h-9" />
            </div>

            {/* Gruppen im Dialog als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (Abschnitt 18). */}
            <div className="glass-tile p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-label flex items-center gap-1.5">
                  <TicketIcon className="h-3 w-3 text-muted-foreground/70" />
                  Bulk-Zutritt über {accessCount === 1 ? "1 Ticket" : `${accessCount} Tickets`}
                </p>
                <button type="button" onClick={() => setTab("accessTickets")}
                        className="min-h-11 shrink-0 text-xs font-medium text-primary hover:underline sm:min-h-0">
                  Bearbeiten
                </button>
              </div>
              {accessCount > 0 ? (
                <div className="space-y-1">
                  {[...selectedAccessTickets].map((idStr) => {
                    const t = allTickets.find((x) => String(x.id) === idStr);
                    if (!t) return null;
                    return (
                      // Handy: Gültigkeit darf unter den Namen umbrechen; Name und Bereiche kürzen beide statt abzuschneiden.
                      <div key={idStr} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
                        <span className="inline-flex items-center gap-1 text-foreground truncate min-w-0">
                          <TicketIcon className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                          <span className="truncate">{ticketDisplayName(t)}</span>
                          {t.areaNames.length > 0 && (
                            <span
                              className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5 min-w-0"
                              title={t.areaNames.join(", ")}
                            >
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{t.areaNames.join(", ")}</span>
                            </span>
                          )}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums shrink-0">
                          <Clock className="h-2.5 w-2.5" />
                          {formatTicketValidity(t)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Noch keine Zutritts-Tickets zugeordnet. Im Tab „Tickets“ ein Ticket (z. B. „Bahnmiete“) auswählen.
                </p>
              )}
            </div>

            <div className="glass-tile p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-label flex items-center gap-1.5">
                  <Users className="h-3 w-3 text-muted-foreground/70" />
                  {selectedMembers.size === 1 ? "1 Mitglied" : `${selectedMembers.size} Mitglieder`}
                </p>
                <button type="button" onClick={() => setTab("members")}
                        className="min-h-11 shrink-0 text-xs font-medium text-primary hover:underline sm:min-h-0">
                  Bearbeiten
                </button>
              </div>
              {selectedMembers.size === 0 && (
                <p className="text-xs text-muted-foreground">Noch keine Mitglieds-Tickets zugeordnet.</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="accessTickets" className="space-y-2">
            <p className="text-xs text-muted-foreground">
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
                      className="min-h-11 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors sm:min-h-0">
                Alle abwählen
              </button>
            )}
          </TabsContent>

          <TabsContent value="members" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Wähle Tickets, die diesem Verein angehören. Tickets, die bereits einem anderen Verein zugeordnet sind, werden hier verschoben.
            </p>

            {!isNew ? (
              <div className="glass-tile border-dashed p-3 space-y-2">
                <p className="text-label inline-flex items-center gap-1.5">
                  <UserPlus className="h-3 w-3 text-muted-foreground/70" />
                  Mitglied ohne Tickettyp anlegen
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={qaFirst}
                    onChange={(e) => setQaFirst(e.target.value)}
                    placeholder="Vorname"
                    className="h-11 sm:h-9"
                    disabled={qaAdding}
                  />
                  <Input
                    value={qaLast}
                    onChange={(e) => setQaLast(e.target.value)}
                    placeholder="Nachname"
                    className="h-11 sm:h-9"
                    disabled={qaAdding}
                  />
                </div>
                {/* Handy: Taste unter dem Feld in voller Breite, damit der Platzhalter ganz lesbar bleibt. */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <ScanLine className="absolute left-2.5 top-1/2 z-10 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                    <Input
                      value={qaCode}
                      onChange={(e) => setQaCode(e.target.value)}
                      placeholder="RFID / Barcode (optional)"
                      className="h-11 sm:h-9 font-mono pl-8"
                      disabled={qaAdding}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleQuickAddMember}
                    disabled={qaAdding || (!qaFirst.trim() && !qaLast.trim())}
                    className="h-11 sm:h-9"
                  >
                    {qaAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Anlegen"}
                  </Button>
                </div>
                {qaError && (
                  <p className="text-xs text-destructive">{qaError}</p>
                )}
                {qaSuccess && !qaError && (
                  <p className="text-xs text-success inline-flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    {qaSuccess} – nicht erneut anlegen.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Ohne Tickettyp/Areas. Zutritt kommt ausschließlich über die Vereins-Zutritts-Tickets im Tab „Tickets“.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
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
                <Badge variant="outline" className="tabular-nums">{selectedMembers.size} ausgewählt</Badge>
                <button type="button" onClick={() => setSelectedMembers(new Set())}
                        className="min-h-11 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors sm:min-h-0">
                  Alle abwählen
                </button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {error && (
          <Notice tone="danger" compact title={error} />
        )}

        <Separator />

        {confirmDelete && verein ? (
          // Rückfrage statt Fußzeile: Abbrechen oder endgültig löschen.
          <div className="space-y-3">
            <Notice tone="danger" compact title={`Verein "${verein.name}" wirklich löschen?`}>
              Mitglieds-Tickets bleiben erhalten, verlieren aber den Vereins-Bulk-Zutritt.
            </Notice>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(false)}
                      disabled={deleting} autoFocus className="h-11 sm:h-9">
                Abbrechen
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}
                      className="h-11 sm:h-9">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                Löschen
              </Button>
            </div>
          </div>
        ) : (
          /* Handy: volle Breite, Primärtaste oben. Ab sm: Löschen links, Handlungen rechts. */
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {!isNew ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={deleting || saving}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-11 sm:h-9">
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Löschen
              </Button>
            ) : <div className="hidden sm:block" />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving || deleting} className="h-11 sm:h-9">
                Abbrechen
              </Button>
              <Button type="button" size="sm" onClick={handleSave}
                      disabled={saving || deleting || !name.trim()}
                      className="min-w-24 h-11 sm:h-9">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <><Save className="h-3.5 w-3.5 mr-1" />{isNew ? "Erstellen" : "Speichern"}</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
