"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Loader2, Trash2, Save, Lock, MapPin, Hash, Ticket as TicketIcon,
  CreditCard, FileText, Search, X, Check, Plus, Calendar, History, Pencil,
  Key, KeyRound, ArrowRightCircle, ArrowLeftCircle, User,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type LockerType = "KEY" | "PADLOCK";

export interface LockerData {
  id: number;
  name: string;
  number: string;
  location: string | null;
  notes: string | null;
  lockType: LockerType;
  keyCount: number;
  lockNumber: string | null;
}

export interface AboTicketRef {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  status: string;
  endDate: string | null;
  subscription: { id: number; name: string } | null;
}

export interface RentalRow {
  id: number;
  year: number;
  notes: string | null;
  /// Optional: verknuepftes Abo-Ticket. Null = manueller Name.
  ticketId: number | null;
  /// Manuell eingegebener Mietername (Fallback ohne Ticket).
  renterName: string | null;
  keysIssued: number;
  keysReturned: number;
  /// ISO-String oder null.
  issuedAt: string | null;
  returnedAt: string | null;
  ticket: AboTicketRef | null;
}

/// Anzeigename: bevorzugt Person-Name aus Ticket, danach Ticket-Anzeigename,
/// danach manueller Name, sonst Fallback "Unbekannt".
export function rentalDisplayName(r: { ticket: AboTicketRef | null; renterName: string | null }): string {
  if (r.ticket) return ticketDisplayName(r.ticket);
  if (r.renterName?.trim()) return r.renterName.trim();
  return "Unbekannt";
}

/// Helfer: Singular/Plural-Label je nach Schloss-Typ.
function itemLabel(lockType: LockerType, plural: boolean): string {
  if (lockType === "PADLOCK") return plural ? "Vorhängeschlösser" : "Vorhängeschloss";
  return plural ? "Schlüssel" : "Schlüssel";
}

/// Datum als „YYYY-MM-DD" für <input type="date">.
function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayDateInput(): string {
  return isoToDateInput(new Date().toISOString());
}

/**
 * Robuste Datum-Eingabe.
 *
 * Warum nicht einfach `<Input type="date" value={...} onChange={...} />`?
 * Reacts controlled-mode kaempft auf einigen Browsern (Chromium, Safari iOS)
 * mit der nativen Date-Picker-Eingabe: solange das Datum noch nicht
 * vollstaendig getippt ist, fired der Browser kein onChange, React forciert
 * aber parallel `value=""` zurueck und das frisch eingegebene Datum
 * "springt" optisch zurueck. Wir halten das DOM-Element daher uncontrolled
 * (`defaultValue`) und syncen externen State nur dann hinein, wenn der Input
 * gerade nicht den Fokus hat.
 */
function DateField({
  value,
  onChange,
  className,
  instanceKey,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  instanceKey?: string | number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.value = value;
    }
  }, [value]);
  return (
    <input
      ref={ref}
      key={instanceKey}
      type="date"
      defaultValue={value}
      onChange={(e) => onChange(e.target.value)}
      // Gleiche Optik wie `Input`: getönte Glas-Füllung, Fokus in Akzentfarbe.
      className={cn(
        "glass-field selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 px-3 py-1 text-base transition-[color,box-shadow,border-color,background-color] outline-none hover:border-foreground/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:bg-glass-strong focus-visible:ring-ring/30 focus-visible:ring-[3px]",
        className,
      )}
    />
  );
}

interface LockerDialogProps {
  locker: LockerData | null;
  initialRentals: RentalRow[];
  aboTickets: AboTicketRef[];
  currentYear: number;
  open: boolean;
  onClose: () => void;
}

function ticketDisplayName(t: AboTicketRef): string {
  const personName = [t.firstName, t.lastName].filter(Boolean).join(" ");
  return personName || t.name;
}

/// Status-Pille eines Tickets als Badge-Variante (Pause = Hinweis, Ende = Störung, ungültig = neutral).
function ticketStatusBadge(t: AboTicketRef): { label: string; variant: "warning" | "danger" | "neutral" } | null {
  if (t.status === "PAUSED") return { label: "Pausiert", variant: "warning" };
  if (t.status === "CANCELED") return { label: "Gekündigt", variant: "danger" };
  if (t.status === "INVALID") return { label: "Ungültig", variant: "neutral" };
  if (t.endDate) {
    const end = new Date(t.endDate);
    if (!isNaN(end.getTime()) && end < new Date()) {
      return { label: "Abgelaufen", variant: "danger" };
    }
  }
  return null;
}

/// Wiederverwendbarer Ticket-Picker mit Suche.
function TicketPicker({
  aboTickets, value, onChange, placeholder, autoFocus,
}: {
  aboTickets: AboTicketRef[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => (value ? aboTickets.find((t) => t.id === value) ?? null : null),
    [value, aboTickets]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return aboTickets.slice(0, 100);
    return aboTickets.filter((t) => {
      const hay = [
        ticketDisplayName(t),
        t.ticketTypeName ?? "",
        t.subscription?.name ?? "",
        t.name,
      ].join(" ").toLowerCase();
      return hay.includes(q);
    }).slice(0, 100);
  }, [aboTickets, query]);

  if (selected && !open) {
    const sb = ticketStatusBadge(selected);
    return (
      <div className="rounded-tile border border-primary/30 bg-primary/10 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate inline-flex items-center gap-1.5">
              <TicketIcon className="h-3.5 w-3.5 text-primary shrink-0" />
              {ticketDisplayName(selected)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {selected.subscription && (
                <Badge variant="secondary" className="font-medium text-foreground/80">
                  <CreditCard className="h-2.5 w-2.5 text-muted-foreground/70" />
                  {selected.subscription.name}
                </Badge>
              )}
              {selected.ticketTypeName && (
                <span className="text-[11px] text-muted-foreground">
                  {selected.ticketTypeName}
                </span>
              )}
              {sb && <Badge variant={sb.variant}>{sb.label}</Badge>}
            </div>
          </div>
          {/* Auf dem Handy 44 px Tippfläche, ab sm kompakt. */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-glass-tile hover:text-primary max-sm:size-11"
              aria-label="Anderes Ticket wählen"
              title="Anderes Ticket wählen"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-glass-tile hover:text-destructive max-sm:size-11"
              aria-label="Ticket entfernen"
              title="Ticket entfernen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="glass-field w-full text-left h-11 sm:h-9 px-3 text-sm text-muted-foreground hover:border-foreground/20 transition-colors inline-flex items-center justify-between"
        >
          <span className="text-muted-foreground">{placeholder ?? "— Ticket wählen —"}</span>
          <Search className="h-3.5 w-3.5 text-muted-foreground/70" />
        </button>
      )}
      {open && (
        <div className="glass-tile p-1.5 space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 z-10 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
            <Input
              type="text"
              autoFocus={autoFocus ?? true}
              placeholder="Mieter, Abo, Tickettyp suchen…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 pl-8 sm:h-9"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto overscroll-contain scrollbar-thin space-y-0.5">
            {filtered.length === 0 ? (
              <EmptyState
                compact
                title={aboTickets.length === 0 ? "Noch keine Abo-Tickets vorhanden." : "Keine Treffer."}
              />
            ) : filtered.map((t) => {
              const isSel = t.id === value;
              const sb = ticketStatusBadge(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onChange(t.id); setOpen(false); setQuery(""); }}
                  className={cn(
                    "w-full flex min-h-11 items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left transition-colors sm:min-h-9",
                    isSel ? "bg-primary/10" : "hover:bg-glass-tile"
                  )}
                >
                  <div className={cn(
                    "size-[18px] rounded-full border flex items-center justify-center shrink-0",
                    isSel ? "bg-primary border-primary text-primary-foreground" : "border-input bg-field"
                  )}>
                    {isSel && <Check className="size-3" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground truncate">
                      {ticketDisplayName(t)}
                    </p>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      {t.subscription && (
                        <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5">
                          <CreditCard className="h-2.5 w-2.5" />
                          {t.subscription.name}
                        </span>
                      )}
                      {t.ticketTypeName && (
                        <span className="text-[11px] text-muted-foreground truncate">· {t.ticketTypeName}</span>
                      )}
                      {sb && <Badge variant={sb.variant} className="px-1.5 py-0 text-[10px]">{sb.label}</Badge>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {value && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 px-1 text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-0"
              >
                Abbrechen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type RenterMode = "ticket" | "manual";

/// Kleiner Tab-Switch zwischen "Abo-Ticket" und "Manueller Name".
function RenterModeToggle({
  mode, onChange, required,
}: {
  mode: RenterMode;
  onChange: (m: RenterMode) => void;
  /// Wenn true wird ein dezenter "*"-Hinweis angezeigt.
  required?: boolean;
}) {
  // Segmentwahl ohne eigene Klassen; in der Ebene getönt (docs/design-regeln.md, Abschnitt 18).
  // Segmented kennt kein title je Option, daher sitzen die Tooltips an den Labels.
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        Mieter{required ? " *" : ""}
      </span>
      <Segmented
        aria-label="Mieter"
        value={mode}
        onValueChange={onChange}
        options={[
          {
            value: "ticket",
            label: (
              <span className="inline-flex items-center gap-1" title="Mieter aus den Abo-Tickets auswählen">
                <TicketIcon className="h-3 w-3" />
                Abo-Ticket
              </span>
            ),
          },
          {
            value: "manual",
            label: (
              <span className="inline-flex items-center gap-1" title="Mietername frei eingeben (ohne Abo-Verknüpfung)">
                <User className="h-3 w-3" />
                Manuell
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

interface RentalEditorState {
  /// id = "new" für neue Vermietungen, sonst die rental.id als string.
  id: number | "new";
  year: number;
  /// Welche Mieter-Variante gerade aktiv ist.
  mode: RenterMode;
  ticketId: number | null;
  renterName: string;
  notes: string;
  keysIssued: number;
  keysReturned: number;
  /// "YYYY-MM-DD" oder leer.
  issuedAtDate: string;
  returnedAtDate: string;
}

export function LockerDialog({
  locker, initialRentals, aboTickets, currentYear, open, onClose,
}: LockerDialogProps) {
  const router = useRouter();
  const isNew = !locker;
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [lockType, setLockType] = useState<LockerType>("KEY");
  const [keyCount, setKeyCount] = useState<number>(2);
  const [lockNumber, setLockNumber] = useState("");
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  /// Bei NEU-Anlage optional eine erste Vermietung mitgeben.
  const [initialRentalTicketId, setInitialRentalTicketId] = useState<number | null>(null);
  const [initialRentalRenterName, setInitialRentalRenterName] = useState("");
  const [initialRentalMode, setInitialRentalMode] = useState<RenterMode>("ticket");
  const [initialRentalYear, setInitialRentalYear] = useState<number>(currentYear);
  /// Inline-Editor-State für vorhandene Schließfächer.
  const [editor, setEditor] = useState<RentalEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingRental, setSavingRental] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Rückfragen als Schritt im selben Dialog (Abschnitt 18), kein Browser-Dialog:
  // Löschen des Schließfachs in der Fußzeile, Entfernen einer Vermietung in ihrer Zeile.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRentalId, setConfirmRentalId] = useState<number | null>(null);
  const [deletingRental, setDeletingRental] = useState(false);
  const [error, setError] = useState("");
  const [rentalError, setRentalError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setRentalError("");
      setEditor(null);
      setConfirmDelete(false);
      setConfirmRentalId(null);
      setInitialRentalTicketId(null);
      setInitialRentalRenterName("");
      setInitialRentalMode("ticket");
      setInitialRentalYear(currentYear);
      if (locker) {
        setName(locker.name);
        setNumber(locker.number);
        setLocation(locker.location ?? "");
        setNotes(locker.notes ?? "");
        setLockType(locker.lockType);
        setKeyCount(locker.keyCount);
        setLockNumber(locker.lockNumber ?? "");
        setRentals(initialRentals);
      } else {
        setName(""); setNumber(""); setLocation(""); setNotes("");
        setLockType("KEY"); setKeyCount(2); setLockNumber("");
        setRentals([]);
      }
    }
  }, [open, locker, initialRentals, currentYear]);

  async function handleSaveLocker() {
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        number: number.trim(),
        location: location.trim() || null,
        notes: notes.trim() || null,
        lockType,
        keyCount,
        lockNumber: lockType === "KEY" ? (lockNumber.trim() || null) : null,
      };
      if (isNew) {
        const wantsTicket = initialRentalMode === "ticket" && initialRentalTicketId != null;
        const wantsManual = initialRentalMode === "manual" && initialRentalRenterName.trim().length > 0;
        if (wantsTicket || wantsManual) {
          payload.initialRental = {
            year: initialRentalYear,
            ...(wantsTicket
              ? { ticketId: initialRentalTicketId }
              : { renterName: initialRentalRenterName.trim() }),
          };
        }
      }
      const url = isNew ? "/api/lockers" : `/api/lockers/${locker!.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(typeof data?.error === "string" ? data.error : `Server-Fehler (${res.status})`);
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
    if (!locker) return;
    setDeleting(true);
    try {
      await fetch(`/api/lockers/${locker.id}`, { method: "DELETE" });
      onClose();
      router.refresh();
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveRental() {
    if (!editor || !locker) return;
    const useTicket = editor.mode === "ticket";
    const useManual = editor.mode === "manual";
    if (useTicket && !editor.ticketId) return;
    if (useManual && !editor.renterName.trim()) return;
    setSavingRental(true);
    setRentalError("");
    try {
      const payload = {
        year: editor.year,
        // Beim Modus-Wechsel das jeweils andere Feld explizit auf null setzen,
        // damit der Server den alten Wert nicht stehen laesst.
        ticketId: useTicket ? editor.ticketId : null,
        renterName: useManual ? editor.renterName.trim() : null,
        notes: editor.notes.trim() || null,
        keysIssued: editor.keysIssued,
        keysReturned: editor.keysReturned,
        issuedAt: editor.issuedAtDate ? editor.issuedAtDate : null,
        returnedAt: editor.returnedAtDate ? editor.returnedAtDate : null,
      };
      const isNewRental = editor.id === "new";
      const url = isNewRental
        ? `/api/lockers/${locker.id}/rentals`
        : `/api/lockers/${locker.id}/rentals/${editor.id}`;
      const res = await fetch(url, {
        method: isNewRental ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRentalError(typeof data?.error === "string" ? data.error : `Server-Fehler (${res.status})`);
        return;
      }
      const saved = (await res.json()) as RentalRow;
      setRentals((prev) => {
        const others = prev.filter((r) => r.id !== saved.id);
        return [...others, saved].sort((a, b) => b.year - a.year);
      });
      setEditor(null);
      router.refresh();
    } catch (err) {
      setRentalError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
    } finally {
      setSavingRental(false);
    }
  }

  async function handleDeleteRental(rental: RentalRow) {
    if (!locker) return;
    setDeletingRental(true);
    setRentalError("");
    try {
      const res = await fetch(`/api/lockers/${locker.id}/rentals/${rental.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRentalError(typeof data?.error === "string" ? data.error : `Server-Fehler (${res.status})`);
        return;
      }
      setRentals((prev) => prev.filter((r) => r.id !== rental.id));
      router.refresh();
    } catch (err) {
      setRentalError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
    } finally {
      setDeletingRental(false);
      setConfirmRentalId(null);
    }
  }

  function startNewRental() {
    setRentalError("");
    setConfirmRentalId(null);
    // Default-Jahr: nächstes freies Jahr nach dem höchsten bestehenden (mind. currentYear).
    const used = new Set(rentals.map((r) => r.year));
    let candidate = currentYear;
    while (used.has(candidate)) candidate++;
    setEditor({
      id: "new",
      year: candidate,
      mode: "ticket",
      ticketId: null,
      renterName: "",
      notes: "",
      keysIssued: 0,
      keysReturned: 0,
      issuedAtDate: "",
      returnedAtDate: "",
    });
  }

  function startEditRental(r: RentalRow) {
    setRentalError("");
    setConfirmRentalId(null);
    setEditor({
      id: r.id,
      year: r.year,
      // Wenn ein Ticket existiert, erstmal Ticket-Modus; wenn nicht, manueller
      // Modus mit dem gespeicherten Namen (oder leer falls beides fehlt).
      mode: r.ticketId ? "ticket" : "manual",
      ticketId: r.ticketId,
      renterName: r.renterName ?? "",
      notes: r.notes ?? "",
      keysIssued: r.keysIssued,
      keysReturned: r.keysReturned,
      issuedAtDate: isoToDateInput(r.issuedAt),
      returnedAtDate: isoToDateInput(r.returnedAt),
    });
  }

  /// Quick-Action: Schlüssel/Schloss ausgeben → Soll-Anzahl + heutiges Datum.
  function quickIssue() {
    if (!editor) return;
    setEditor({
      ...editor,
      keysIssued: editor.keysIssued > 0 ? editor.keysIssued : Math.max(keyCount, 1),
      issuedAtDate: editor.issuedAtDate || todayDateInput(),
    });
  }
  /// Quick-Action: Komplette Rücknahme → keysReturned = keysIssued + heutiges Datum.
  function quickReturn() {
    if (!editor) return;
    setEditor({
      ...editor,
      keysReturned: editor.keysIssued,
      returnedAtDate: editor.returnedAtDate || todayDateInput(),
    });
  }

  const usedYearsForOtherRentals = useMemo(() => {
    if (!editor) return new Set<number>();
    return new Set(rentals.filter((r) => r.id !== editor.id).map((r) => r.year));
  }, [rentals, editor]);

  const editorYearConflict = editor && usedYearsForOtherRentals.has(editor.year);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Neues Schließfach anlegen" : "Schließfach bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Handy: eine Spalte, damit „Standort“ nicht abgeschnitten wird. */}
          <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
            <div className="space-y-1.5 xs:col-span-2">
              <Label htmlFor="l-name" className="text-[13px] inline-flex items-center gap-1">
                <Lock className="h-3 w-3 text-muted-foreground/70" />
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="l-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Spind 12" required autoFocus className="h-11 sm:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-number" className="text-[13px] inline-flex items-center gap-1">
                <Hash className="h-3 w-3 text-muted-foreground/70" />
                Nummer <span className="text-destructive">*</span>
              </Label>
              <Input
                id="l-number" value={number} onChange={(e) => setNumber(e.target.value)}
                placeholder="A12" required className="h-11 sm:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-location" className="text-[13px] inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-muted-foreground/70" />
                Standort
              </Label>
              <Input
                id="l-location" value={location} onChange={(e) => setLocation(e.target.value)}
                placeholder="z. B. Umkleide UG" className="h-11 sm:h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="l-notes" className="text-[13px] inline-flex items-center gap-1">
              <FileText className="h-3 w-3 text-muted-foreground/70" />
              Notiz
            </Label>
            <Input
              id="l-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional, z. B. Schloss-Code" className="h-11 sm:h-9"
            />
          </div>

          {/* Schlosstyp + Anzahl; auf dem Handy untereinander */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3 sm:items-end">
            <div className="space-y-1.5">
              <Label className="text-[13px] inline-flex items-center gap-1">
                <KeyRound className="h-3 w-3 text-muted-foreground/70" />
                Schlosstyp
              </Label>
              {/* Segmentwahl statt zweier Kästen; die Anzahl passt sich wie bisher dem Typ an. */}
              <Segmented
                aria-label="Schlosstyp"
                stretch
                value={lockType}
                onValueChange={(v) => {
                  if (v === "KEY") {
                    setLockType("KEY");
                    if (keyCount === 0) setKeyCount(2);
                  } else {
                    setLockType("PADLOCK");
                    if (keyCount > 1) setKeyCount(1);
                  }
                }}
                options={[
                  {
                    value: "KEY",
                    label: (
                      <>
                        <Key className="h-3.5 w-3.5" />
                        Schlüssel
                      </>
                    ),
                  },
                  {
                    value: "PADLOCK",
                    label: (
                      <>
                        <Lock className="h-3.5 w-3.5" />
                        Vorhängeschloss
                      </>
                    ),
                  },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-keycount" className="text-[13px]">
                Anzahl {itemLabel(lockType, true)}
              </Label>
              {/* 44 px hoch wie die Segmentwahl daneben. */}
              <Input
                id="l-keycount"
                type="number" min={0} max={20}
                value={keyCount}
                onChange={(e) => setKeyCount(Math.max(0, Number(e.target.value) || 0))}
                className="h-11 tabular-nums"
              />
            </div>
          </div>

          {lockType === "KEY" && (
            <div className="space-y-1.5">
              <Label htmlFor="l-locknumber" className="text-[13px] inline-flex items-center gap-1">
                <Key className="h-3 w-3 text-muted-foreground/70" />
                Schlossnummer
              </Label>
              <Input
                id="l-locknumber"
                value={lockNumber}
                onChange={(e) => setLockNumber(e.target.value)}
                placeholder="z. B. 6897"
                className="h-11 sm:h-9 font-mono"
              />
            </div>
          )}
        </div>

        <Separator />

        {/* Vermietungs-Block */}
        {isNew ? (
          <div className="space-y-2">
            <Label className="text-[13px] inline-flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="h-3 w-3 text-muted-foreground/70" />
              Erste Vermietung (optional)
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-3 items-start">
              <div className="space-y-1">
                <Label htmlFor="l-initial-year" className="text-xs font-normal text-muted-foreground">Jahr</Label>
                <Input
                  id="l-initial-year"
                  type="number"
                  value={initialRentalYear}
                  onChange={(e) => setInitialRentalYear(Number(e.target.value) || currentYear)}
                  min={2000} max={2100}
                  className="h-11 sm:h-9 tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <RenterModeToggle
                  mode={initialRentalMode}
                  onChange={(m) => {
                    setInitialRentalMode(m);
                    if (m === "ticket") setInitialRentalRenterName("");
                    else setInitialRentalTicketId(null);
                  }}
                />
                {initialRentalMode === "ticket" ? (
                  <TicketPicker
                    aboTickets={aboTickets}
                    value={initialRentalTicketId}
                    onChange={setInitialRentalTicketId}
                    placeholder="— Frei lassen oder Ticket wählen —"
                    autoFocus={false}
                  />
                ) : (
                  <Input
                    value={initialRentalRenterName}
                    onChange={(e) => setInitialRentalRenterName(e.target.value)}
                    placeholder="z. B. Familie Mustermann"
                    className="h-11 sm:h-9"
                  />
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Weitere Jahre kannst du nach dem Anlegen hinzufügen.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[13px] inline-flex items-center gap-1.5 text-muted-foreground">
                <History className="h-3.5 w-3.5 text-muted-foreground/70" />
                Vermietungs-Historie ({rentals.length})
              </Label>
              {!editor && (
                <button
                  type="button"
                  onClick={startNewRental}
                  className="min-h-11 text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 sm:min-h-0"
                >
                  <Plus className="h-3 w-3" />
                  Jahr hinzufügen
                </button>
              )}
            </div>

            {rentals.length === 0 && !editor && (
              <EmptyState
                compact
                icon={History}
                title="Noch keine Vermietung hinterlegt."
                className="rounded-tile border border-dashed border-border"
              />
            )}

            <div className="space-y-1.5">
              {rentals.map((r) => {
                const isCurrent = r.year === currentYear;
                const isEditing = editor && editor.id === r.id;
                if (isEditing) return null;
                if (confirmRentalId === r.id && !editor) {
                  // Rückfrage in der Zeile selbst: Abbrechen oder endgültig entfernen.
                  return (
                    <Notice
                      key={r.id}
                      tone="danger"
                      compact
                      title={`Vermietung ${r.year} (${rentalDisplayName(r)}) wirklich entfernen?`}
                    >
                      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button
                          type="button" variant="outline" size="sm"
                          onClick={() => setConfirmRentalId(null)}
                          disabled={deletingRental}
                          autoFocus
                          className="h-11 sm:h-8"
                        >
                          Abbrechen
                        </Button>
                        <Button
                          type="button" variant="destructive" size="sm"
                          onClick={() => handleDeleteRental(r)}
                          disabled={deletingRental}
                          className="h-11 sm:h-8"
                        >
                          {deletingRental
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                          Entfernen
                        </Button>
                      </div>
                    </Notice>
                  );
                }
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "rounded-tile p-2.5 flex items-center gap-2.5",
                      // Laufendes Jahr in Akzentfarbe (Auswahl), sonst Glas-Kachel; Grün bleibt „alle Schlüssel zurück“.
                      isCurrent
                        ? "border border-primary/30 bg-primary/10"
                        : "glass-tile"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 px-2 py-1 rounded-lg font-mono text-xs font-semibold tabular-nums",
                      isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-foreground/[0.06] text-muted-foreground dark:bg-white/[0.08]"
                    )}>
                      {r.year}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate inline-flex items-center gap-1.5">
                        {r.ticket
                          ? <TicketIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                          : <User className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />}
                        {rentalDisplayName(r)}
                      </p>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {r.ticket?.subscription && (
                          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5">
                            <CreditCard className="h-2.5 w-2.5" />
                            {r.ticket.subscription.name}
                          </span>
                        )}
                        {!r.ticket && r.renterName && (
                          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5">
                            <User className="h-2.5 w-2.5" />
                            Manuell
                          </span>
                        )}
                        {r.keysIssued > 0 && (() => {
                          const open = r.keysIssued - r.keysReturned;
                          const allBack = open <= 0;
                          return (
                            <Badge
                              variant={allBack ? "success" : "warning"}
                              className="tabular-nums"
                              title={
                                allBack
                                  ? `Alle ${itemLabel(lockType, r.keysIssued !== 1)} zurück`
                                  : `${open} ${itemLabel(lockType, open !== 1)} noch draußen`
                              }
                            >
                              {lockType === "KEY" ? <Key className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                              {r.keysReturned}/{r.keysIssued}
                            </Badge>
                          );
                        })()}
                        {r.notes && (
                          <span className="text-[11px] text-muted-foreground truncate">· {r.notes}</span>
                        )}
                      </div>
                    </div>
                    {!editor && (
                      <div className="shrink-0 flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => startEditRental(r)}
                          className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-glass-tile hover:text-primary max-sm:size-11"
                          title="Bearbeiten"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRentalId(r.id)}
                          className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-glass-tile hover:text-destructive max-sm:size-11"
                          title="Entfernen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {editor && (
                // Bearbeitungsblock: Rand in Akzentfarbe zeigt, welche Zeile gerade offen ist.
                <div className="rounded-tile border border-primary/30 bg-glass-tile p-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-3 items-start">
                    <div className="space-y-1">
                      <Label htmlFor="l-rental-year" className="text-xs font-normal text-muted-foreground">Jahr</Label>
                      {/* Belegtes Jahr sperrt das Speichern: Fehler am Feld (aria-invalid) statt Hinweisfarbe. */}
                      <Input
                        id="l-rental-year"
                        type="number"
                        value={editor.year}
                        onChange={(e) => setEditor({ ...editor, year: Number(e.target.value) || currentYear })}
                        min={2000} max={2100}
                        aria-invalid={editorYearConflict ? true : undefined}
                        aria-describedby={editorYearConflict ? "l-rental-year-error" : undefined}
                        className="h-11 sm:h-9 tabular-nums"
                      />
                      {editorYearConflict && (
                        <p id="l-rental-year-error" className="text-xs text-destructive">Jahr bereits vergeben.</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <RenterModeToggle
                        mode={editor.mode}
                        onChange={(m) => setEditor({
                          ...editor,
                          mode: m,
                          // Beim Umschalten den jeweils anderen Wert leeren,
                          // damit beim Speichern eindeutig ist, was gemeint ist.
                          ticketId: m === "ticket" ? editor.ticketId : null,
                          renterName: m === "manual" ? editor.renterName : "",
                        })}
                        required
                      />
                      {editor.mode === "ticket" ? (
                        <TicketPicker
                          aboTickets={aboTickets}
                          value={editor.ticketId}
                          onChange={(id) => setEditor({ ...editor, ticketId: id })}
                        />
                      ) : (
                        <Input
                          value={editor.renterName}
                          onChange={(e) => setEditor({ ...editor, renterName: e.target.value })}
                          placeholder="z. B. Familie Mustermann"
                          autoFocus
                          className="h-11 sm:h-9"
                        />
                      )}
                    </div>
                  </div>

                  {/* Schlüssel/Schloss-Ausgabe + Rücknahme */}
                  {keyCount > 0 && (
                    // Neutrale Gruppe: Warnfarbe nur, wenn wirklich etwas draußen ist („Noch … draußen.“).
                    <div className="glass-tile p-2.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1">
                          {lockType === "KEY"
                            ? <Key className="h-3 w-3" />
                            : <Lock className="h-3 w-3" />}
                          {itemLabel(lockType, true)} (Soll: {keyCount})
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button" variant="outline" size="sm"
                            onClick={quickIssue}
                            disabled={editor.keysIssued >= editor.keysReturned && editor.keysReturned > 0}
                            className="h-11 sm:h-8"
                            title="Ausgabe erfassen (heute, Soll-Anzahl)"
                          >
                            <ArrowRightCircle className="h-3 w-3" />
                            Ausgeben
                          </Button>
                          <Button
                            type="button" variant="outline" size="sm"
                            onClick={quickReturn}
                            disabled={editor.keysIssued === 0 || editor.keysReturned >= editor.keysIssued}
                            className="h-11 sm:h-8"
                            title="Komplette Rücknahme (heute)"
                          >
                            <ArrowLeftCircle className="h-3 w-3" />
                            Zurück
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor="l-keys-issued" className="gap-1 text-xs font-normal text-muted-foreground">
                            <ArrowRightCircle className="h-2.5 w-2.5" />
                            Ausgegeben
                          </Label>
                          <div className="flex gap-1.5">
                            <Input
                              id="l-keys-issued"
                              type="number" min={0} max={20}
                              value={editor.keysIssued}
                              onChange={(e) => {
                                const v = Math.max(0, Number(e.target.value) || 0);
                                setEditor({
                                  ...editor,
                                  keysIssued: v,
                                  keysReturned: Math.min(editor.keysReturned, v),
                                });
                              }}
                              className="h-11 w-14 shrink-0 tabular-nums sm:h-9"
                            />
                            <DateField
                              value={editor.issuedAtDate}
                              onChange={(v) => setEditor({ ...editor, issuedAtDate: v })}
                              className="h-11 sm:h-9 flex-1 min-w-0"
                              instanceKey={`${editor.id ?? "new"}-issued`}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="l-keys-returned" className="gap-1 text-xs font-normal text-muted-foreground">
                            <ArrowLeftCircle className="h-2.5 w-2.5" />
                            Zurückgegeben
                          </Label>
                          <div className="flex gap-1.5">
                            <Input
                              id="l-keys-returned"
                              type="number" min={0} max={editor.keysIssued}
                              value={editor.keysReturned}
                              onChange={(e) => setEditor({
                                ...editor,
                                keysReturned: Math.min(editor.keysIssued, Math.max(0, Number(e.target.value) || 0)),
                              })}
                              className="h-11 w-14 shrink-0 tabular-nums sm:h-9"
                            />
                            <DateField
                              value={editor.returnedAtDate}
                              onChange={(v) => setEditor({ ...editor, returnedAtDate: v })}
                              className="h-11 sm:h-9 flex-1 min-w-0"
                              instanceKey={`${editor.id ?? "new"}-returned`}
                            />
                          </div>
                        </div>
                      </div>
                      {editor.keysIssued > 0 && editor.keysReturned < editor.keysIssued && (
                        <p className="text-xs text-warning">
                          Noch {editor.keysIssued - editor.keysReturned} {itemLabel(lockType, editor.keysIssued - editor.keysReturned !== 1)} draußen.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor="l-rental-notes" className="text-xs font-normal text-muted-foreground">Notiz (optional)</Label>
                    <Input
                      id="l-rental-notes"
                      value={editor.notes}
                      onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
                      placeholder="z. B. Bezahlt am 15.03."
                      className="h-11 sm:h-9"
                    />
                  </div>
                  {rentalError && (
                    <Notice tone="danger" compact title={rentalError} />
                  )}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setEditor(null); setRentalError(""); }}
                      disabled={savingRental}
                      className="h-11 sm:h-9"
                    >
                      Abbrechen
                    </Button>
                    <Button
                      type="button" size="sm"
                      onClick={handleSaveRental}
                      disabled={
                        savingRental
                        || !!editorYearConflict
                        || (editor.mode === "ticket"
                          ? !editor.ticketId
                          : !editor.renterName.trim())
                      }
                      className="h-11 sm:h-9"
                    >
                      {savingRental
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <><Check className="h-3 w-3 mr-1" />{editor.id === "new" ? "Hinzufügen" : "Speichern"}</>}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {rentalError && !editor && (
              <Notice tone="danger" compact title={rentalError} />
            )}
          </div>
        )}

        {error && (
          <Notice tone="danger" compact title={error} />
        )}

        <Separator />

        {confirmDelete && locker ? (
          // Rückfrage statt Fußzeile: Abbrechen oder endgültig löschen.
          <div className="space-y-3">
            <Notice
              tone="danger"
              compact
              title={`Schließfach "${locker.name}" (Nr. ${locker.number}) inkl. gesamter Vermietungs-Historie wirklich löschen?`}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                autoFocus
                className="h-11 sm:h-9"
              >
                Abbrechen
              </Button>
              <Button
                type="button" variant="destructive" size="sm" onClick={handleDelete}
                disabled={deleting}
                className="h-11 sm:h-9"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                Löschen
              </Button>
            </div>
          </div>
        ) : (
          /* Handy: volle Breite, Primärtaste oben. Ab sm: Löschen links, Handlungen rechts. */
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {!isNew ? (
              <Button
                type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}
                disabled={deleting || saving}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-11 sm:h-9"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Löschen
              </Button>
            ) : <div className="hidden sm:block" />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button" variant="outline" size="sm" onClick={onClose}
                disabled={saving || deleting} className="h-11 sm:h-9"
              >
                {isNew ? "Abbrechen" : "Schließen"}
              </Button>
              <Button
                type="button" size="sm" onClick={handleSaveLocker}
                disabled={saving || deleting || !name.trim() || !number.trim()}
                className="min-w-24 h-11 sm:h-9"
              >
                {saving
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <><Save className="h-3.5 w-3.5 mr-1" />{isNew ? "Erstellen" : "Speichern"}</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
