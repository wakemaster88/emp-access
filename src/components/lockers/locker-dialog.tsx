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
      className={cn(
        "border-input dark:bg-input/30 selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
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

function ticketStatusBadge(t: AboTicketRef): { label: string; cls: string } | null {
  if (t.status === "PAUSED") return { label: "Pausiert", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" };
  if (t.status === "CANCELED") return { label: "Gekündigt", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" };
  if (t.status === "INVALID") return { label: "Ungültig", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  if (t.endDate) {
    const end = new Date(t.endDate);
    if (!isNaN(end.getTime()) && end < new Date()) {
      return { label: "Abgelaufen", cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" };
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
      <div className="rounded-md border border-violet-200 dark:border-violet-900/40 bg-violet-50/30 dark:bg-violet-950/10 p-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate inline-flex items-center gap-1.5">
              <TicketIcon className="h-3.5 w-3.5 text-violet-500 shrink-0" />
              {ticketDisplayName(selected)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {selected.subscription && (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1 text-[10px] py-0">
                  <CreditCard className="h-2.5 w-2.5" />
                  {selected.subscription.name}
                </Badge>
              )}
              {selected.ticketTypeName && (
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {selected.ticketTypeName}
                </span>
              )}
              {sb && <Badge className={cn("text-[10px] py-0", sb.cls)}>{sb.label}</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-slate-400 hover:text-indigo-500 p-1"
              aria-label="Anderes Ticket wählen"
              title="Anderes Ticket wählen"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-slate-400 hover:text-rose-500 p-1"
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
          className="w-full text-left h-9 px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-500 hover:border-indigo-300 transition-colors inline-flex items-center justify-between"
        >
          <span className="text-slate-400">{placeholder ?? "— Ticket wählen —"}</span>
          <Search className="h-3.5 w-3.5 text-slate-400" />
        </button>
      )}
      {open && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              autoFocus={autoFocus ?? true}
              placeholder="Mieter, Abo, Tickettyp suchen…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-slate-400 py-4 text-center">
                {aboTickets.length === 0 ? "Noch keine Abo-Tickets vorhanden." : "Keine Treffer."}
              </p>
            ) : filtered.map((t) => {
              const isSel = t.id === value;
              const sb = ticketStatusBadge(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onChange(t.id); setOpen(false); setQuery(""); }}
                  className={cn(
                    "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                    isSel ? "bg-violet-50 dark:bg-violet-900/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded-full border flex items-center justify-center shrink-0",
                    isSel ? "bg-violet-500 border-violet-500" : "border-slate-300 dark:border-slate-600"
                  )}>
                    {isSel && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700 dark:text-slate-300 truncate">
                      {ticketDisplayName(t)}
                    </p>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      {t.subscription && (
                        <span className="text-[10px] text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-0.5">
                          <CreditCard className="h-2.5 w-2.5" />
                          {t.subscription.name}
                        </span>
                      )}
                      {t.ticketTypeName && (
                        <span className="text-[10px] text-slate-400 truncate">· {t.ticketTypeName}</span>
                      )}
                      {sb && <span className={cn("text-[9px] px-1 rounded", sb.cls)}>{sb.label}</span>}
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
                className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1"
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
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-slate-500 dark:text-slate-400">
        Mieter{required ? " *" : ""}
      </span>
      <div
        role="tablist"
        className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-0.5 gap-0.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "ticket"}
          onClick={() => onChange("ticket")}
          className={cn(
            "inline-flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition-colors",
            mode === "ticket"
              ? "bg-white dark:bg-slate-800 text-violet-700 dark:text-violet-300 shadow-sm"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
          )}
          title="Mieter aus den Abo-Tickets auswählen"
        >
          <TicketIcon className="h-3 w-3" />
          Abo-Ticket
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          onClick={() => onChange("manual")}
          className={cn(
            "inline-flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition-colors",
            mode === "manual"
              ? "bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 shadow-sm"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
          )}
          title="Mietername frei eingeben (ohne Abo-Verknüpfung)"
        >
          <User className="h-3 w-3" />
          Manuell
        </button>
      </div>
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
  const [error, setError] = useState("");
  const [rentalError, setRentalError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setRentalError("");
      setEditor(null);
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
    if (!locker || !confirm(`Schließfach "${locker.name}" (Nr. ${locker.number}) inkl. gesamter Vermietungs-Historie wirklich löschen?`)) return;
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
    if (!confirm(`Vermietung ${rental.year} (${rentalDisplayName(rental)}) wirklich entfernen?`)) return;
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
    }
  }

  function startNewRental() {
    setRentalError("");
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-base">
            {isNew ? "Neues Schließfach anlegen" : "Schließfach bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label htmlFor="l-name" className="text-xs inline-flex items-center gap-1">
                <Lock className="h-3 w-3 text-slate-400" />
                Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="l-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Spind 12" required autoFocus className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="l-number" className="text-xs inline-flex items-center gap-1">
                <Hash className="h-3 w-3 text-slate-400" />
                Nummer <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="l-number" value={number} onChange={(e) => setNumber(e.target.value)}
                placeholder="A12" required className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="l-location" className="text-xs inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-slate-400" />
                Standort
              </Label>
              <Input
                id="l-location" value={location} onChange={(e) => setLocation(e.target.value)}
                placeholder="z. B. Umkleide UG" className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="l-notes" className="text-xs inline-flex items-center gap-1">
              <FileText className="h-3 w-3 text-slate-400" />
              Notiz
            </Label>
            <Input
              id="l-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional, z. B. Schloss-Code" className="h-9"
            />
          </div>

          {/* Schlosstyp + Anzahl */}
          <div className="grid grid-cols-[1fr_120px] gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs inline-flex items-center gap-1">
                <KeyRound className="h-3 w-3 text-slate-400" />
                Schlosstyp
              </Label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setLockType("KEY");
                    if (keyCount === 0) setKeyCount(2);
                  }}
                  className={cn(
                    "h-9 px-2 rounded-md border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors",
                    lockType === "KEY"
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600"
                  )}
                >
                  <Key className="h-3.5 w-3.5" />
                  Schlüssel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLockType("PADLOCK");
                    if (keyCount > 1) setKeyCount(1);
                  }}
                  className={cn(
                    "h-9 px-2 rounded-md border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors",
                    lockType === "PADLOCK"
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600"
                  )}
                >
                  <Lock className="h-3.5 w-3.5" />
                  Vorhängeschloss
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="l-keycount" className="text-xs">
                Anzahl {itemLabel(lockType, true)}
              </Label>
              <Input
                id="l-keycount"
                type="number" min={0} max={20}
                value={keyCount}
                onChange={(e) => setKeyCount(Math.max(0, Number(e.target.value) || 0))}
                className="h-9 text-sm tabular-nums"
              />
            </div>
          </div>

          {lockType === "KEY" && (
            <div className="space-y-1">
              <Label htmlFor="l-locknumber" className="text-xs inline-flex items-center gap-1">
                <Key className="h-3 w-3 text-slate-400" />
                Schlossnummer
              </Label>
              <Input
                id="l-locknumber"
                value={lockNumber}
                onChange={(e) => setLockNumber(e.target.value)}
                placeholder="z. B. 6897"
                className="h-9 font-mono"
              />
            </div>
          )}
        </div>

        <Separator className="dark:bg-slate-800" />

        {/* Vermietungs-Block */}
        {isNew ? (
          <div className="space-y-2">
            <Label className="text-xs inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <Calendar className="h-3 w-3 text-slate-400" />
              Erste Vermietung (optional)
            </Label>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-start">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400">Jahr</span>
                <Input
                  type="number"
                  value={initialRentalYear}
                  onChange={(e) => setInitialRentalYear(Number(e.target.value) || currentYear)}
                  min={2000} max={2100}
                  className="h-9 text-sm"
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
                    className="h-9 text-sm"
                  />
                )}
              </div>
            </div>
            <p className="text-[10px] text-slate-400">
              Weitere Jahre kannst du nach dem Anlegen hinzufügen.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <History className="h-3.5 w-3.5 text-slate-400" />
                Vermietungs-Historie ({rentals.length})
              </Label>
              {!editor && (
                <button
                  type="button"
                  onClick={startNewRental}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-0.5"
                >
                  <Plus className="h-3 w-3" />
                  Jahr hinzufügen
                </button>
              )}
            </div>

            {rentals.length === 0 && !editor && (
              <p className="text-[11px] text-slate-400 py-3 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-md">
                Noch keine Vermietung hinterlegt.
              </p>
            )}

            <div className="space-y-1.5">
              {rentals.map((r) => {
                const isCurrent = r.year === currentYear;
                const isEditing = editor && editor.id === r.id;
                if (isEditing) return null;
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "rounded-md border p-2 flex items-center gap-2",
                      isCurrent
                        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/10"
                        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 px-2 py-1 rounded font-mono text-xs font-semibold tabular-nums",
                      isCurrent
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                    )}>
                      {r.year}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate inline-flex items-center gap-1.5">
                        {r.ticket
                          ? <TicketIcon className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                          : <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                        {rentalDisplayName(r)}
                      </p>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {r.ticket?.subscription && (
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-0.5">
                            <CreditCard className="h-2.5 w-2.5" />
                            {r.ticket.subscription.name}
                          </span>
                        )}
                        {!r.ticket && r.renterName && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-0.5">
                            <User className="h-2.5 w-2.5" />
                            Manuell
                          </span>
                        )}
                        {r.keysIssued > 0 && (() => {
                          const open = r.keysIssued - r.keysReturned;
                          const allBack = open <= 0;
                          return (
                            <span
                              className={cn(
                                "text-[10px] inline-flex items-center gap-0.5 px-1 rounded",
                                allBack
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                              )}
                              title={
                                allBack
                                  ? `Alle ${itemLabel(lockType, r.keysIssued !== 1)} zurück`
                                  : `${open} ${itemLabel(lockType, open !== 1)} noch draußen`
                              }
                            >
                              {lockType === "KEY" ? <Key className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                              {r.keysReturned}/{r.keysIssued}
                            </span>
                          );
                        })()}
                        {r.notes && (
                          <span className="text-[10px] text-slate-400 truncate">· {r.notes}</span>
                        )}
                      </div>
                    </div>
                    {!editor && (
                      <div className="shrink-0 flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => startEditRental(r)}
                          className="text-slate-400 hover:text-indigo-500 p-1"
                          title="Bearbeiten"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRental(r)}
                          className="text-slate-400 hover:text-rose-500 p-1"
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
                <div className="rounded-md border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/10 p-3 space-y-2">
                  <div className="grid grid-cols-[100px_1fr] gap-2 items-start">
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">Jahr</span>
                      <Input
                        type="number"
                        value={editor.year}
                        onChange={(e) => setEditor({ ...editor, year: Number(e.target.value) || currentYear })}
                        min={2000} max={2100}
                        className="h-9 text-sm"
                      />
                      {editorYearConflict && (
                        <p className="text-[10px] text-amber-600">Jahr bereits vergeben.</p>
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
                          className="h-9 text-sm"
                        />
                      )}
                    </div>
                  </div>

                  {/* Schlüssel/Schloss-Ausgabe + Rücknahme */}
                  {keyCount > 0 && (
                    <div className="rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10 p-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-amber-800 dark:text-amber-300 inline-flex items-center gap-1">
                          {lockType === "KEY"
                            ? <Key className="h-3 w-3" />
                            : <Lock className="h-3 w-3" />}
                          {itemLabel(lockType, true)} (Soll: {keyCount})
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={quickIssue}
                            disabled={editor.keysIssued >= editor.keysReturned && editor.keysReturned > 0}
                            className="text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Ausgabe erfassen (heute, Soll-Anzahl)"
                          >
                            <ArrowRightCircle className="h-3 w-3" />
                            Ausgeben
                          </button>
                          <button
                            type="button"
                            onClick={quickReturn}
                            disabled={editor.keysIssued === 0 || editor.keysReturned >= editor.keysIssued}
                            className="text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-950/30 dark:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Komplette Rücknahme (heute)"
                          >
                            <ArrowLeftCircle className="h-3 w-3" />
                            Zurück
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-0.5">
                            <ArrowRightCircle className="h-2.5 w-2.5" />
                            Ausgegeben
                          </span>
                          <div className="flex gap-1">
                            <Input
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
                              className="h-7 w-12 text-xs tabular-nums"
                            />
                            <DateField
                              value={editor.issuedAtDate}
                              onChange={(v) => setEditor({ ...editor, issuedAtDate: v })}
                              className="h-7 text-xs flex-1 min-w-0"
                              instanceKey={`${editor.id ?? "new"}-issued`}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-0.5">
                            <ArrowLeftCircle className="h-2.5 w-2.5" />
                            Zurückgegeben
                          </span>
                          <div className="flex gap-1">
                            <Input
                              type="number" min={0} max={editor.keysIssued}
                              value={editor.keysReturned}
                              onChange={(e) => setEditor({
                                ...editor,
                                keysReturned: Math.min(editor.keysIssued, Math.max(0, Number(e.target.value) || 0)),
                              })}
                              className="h-7 w-12 text-xs tabular-nums"
                            />
                            <DateField
                              value={editor.returnedAtDate}
                              onChange={(v) => setEditor({ ...editor, returnedAtDate: v })}
                              className="h-7 text-xs flex-1 min-w-0"
                              instanceKey={`${editor.id ?? "new"}-returned`}
                            />
                          </div>
                        </div>
                      </div>
                      {editor.keysIssued > 0 && editor.keysReturned < editor.keysIssued && (
                        <p className="text-[10px] text-amber-700 dark:text-amber-400">
                          Noch {editor.keysIssued - editor.keysReturned} {itemLabel(lockType, editor.keysIssued - editor.keysReturned !== 1)} draußen.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">Notiz (optional)</span>
                    <Input
                      value={editor.notes}
                      onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
                      placeholder="z. B. Bezahlt am 15.03."
                      className="h-8 text-xs"
                    />
                  </div>
                  {rentalError && (
                    <p className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 rounded">{rentalError}</p>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setEditor(null); setRentalError(""); }}
                      disabled={savingRental}
                      className="h-7 text-xs"
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
                      className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700"
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
              <p className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 rounded">{rentalError}</p>
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
              type="button" variant="ghost" size="sm" onClick={handleDelete}
              disabled={deleting || saving}
              className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 h-8 text-xs"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
              Löschen
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button
              type="button" variant="outline" size="sm" onClick={onClose}
              disabled={saving || deleting} className="h-8"
            >
              {isNew ? "Abbrechen" : "Schließen"}
            </Button>
            <Button
              type="button" size="sm" onClick={handleSaveLocker}
              disabled={saving || deleting || !name.trim() || !number.trim()}
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
