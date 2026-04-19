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
  Loader2, Trash2, Save, Lock, MapPin, Hash, Ticket as TicketIcon,
  CreditCard, FileText, Search, X, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface LockerData {
  id: number;
  name: string;
  number: string;
  location: string | null;
  notes: string | null;
  ticketId: number | null;
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

interface LockerDialogProps {
  locker: LockerData | null;
  aboTickets: AboTicketRef[];
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

export function LockerDialog({ locker, aboTickets, open, onClose }: LockerDialogProps) {
  const router = useRouter();
  const isNew = !locker;
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [ticketQuery, setTicketQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setTicketQuery("");
      setPickerOpen(false);
      if (locker) {
        setName(locker.name);
        setNumber(locker.number);
        setLocation(locker.location ?? "");
        setNotes(locker.notes ?? "");
        setTicketId(locker.ticketId);
      } else {
        setName("");
        setNumber("");
        setLocation("");
        setNotes("");
        setTicketId(null);
      }
    }
  }, [open, locker]);

  const selectedTicket = useMemo(
    () => (ticketId ? aboTickets.find((t) => t.id === ticketId) ?? null : null),
    [ticketId, aboTickets]
  );

  const filteredTickets = useMemo(() => {
    const q = ticketQuery.trim().toLowerCase();
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
  }, [aboTickets, ticketQuery]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        number: number.trim(),
        location: location.trim() || null,
        notes: notes.trim() || null,
        ticketId,
      };
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
    if (!locker || !confirm(`Schließfach "${locker.name}" (Nr. ${locker.number}) wirklich löschen?`)) return;
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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
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
                id="l-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Spind 12"
                required
                autoFocus
                className="h-9"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="l-number" className="text-xs inline-flex items-center gap-1">
                <Hash className="h-3 w-3 text-slate-400" />
                Nummer <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="l-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="A12"
                required
                className="h-9"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="l-location" className="text-xs inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-slate-400" />
                Standort
              </Label>
              <Input
                id="l-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="z. B. Umkleide UG"
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs inline-flex items-center gap-1">
              <TicketIcon className="h-3 w-3 text-slate-400" />
              Verknüpftes Abo-Ticket
            </Label>

            {selectedTicket ? (
              <div className="rounded-md border border-violet-200 dark:border-violet-900/40 bg-violet-50/30 dark:bg-violet-950/10 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate inline-flex items-center gap-1.5">
                      <TicketIcon className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                      {ticketDisplayName(selectedTicket)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {selectedTicket.subscription && (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1 text-[10px] py-0">
                          <CreditCard className="h-2.5 w-2.5" />
                          {selectedTicket.subscription.name}
                        </Badge>
                      )}
                      {selectedTicket.ticketTypeName && (
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {selectedTicket.ticketTypeName}
                        </span>
                      )}
                      {(() => {
                        const sb = ticketStatusBadge(selectedTicket);
                        return sb
                          ? <Badge className={cn("text-[10px] py-0", sb.cls)}>{sb.label}</Badge>
                          : null;
                      })()}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setTicketId(null); setPickerOpen(true); }}
                    className="text-slate-400 hover:text-rose-500 shrink-0"
                    aria-label="Verknüpfung entfernen"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="w-full text-left h-9 px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-500 hover:border-indigo-300 transition-colors inline-flex items-center justify-between"
              >
                <span className="text-slate-400">— Kein Ticket — (Schließfach ist frei)</span>
                <Search className="h-3.5 w-3.5 text-slate-400" />
              </button>
            )}

            {pickerOpen && (
              <div className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Mieter, Abo, Tickettyp suchen…"
                    value={ticketQuery}
                    onChange={(e) => setTicketQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="max-h-[220px] overflow-y-auto space-y-0.5">
                  {filteredTickets.length === 0 ? (
                    <p className="text-[11px] text-slate-400 py-4 text-center">
                      {aboTickets.length === 0
                        ? "Noch keine Abo-Tickets vorhanden."
                        : "Keine Treffer."}
                    </p>
                  ) : filteredTickets.map((t) => {
                    const isSel = t.id === ticketId;
                    const sb = ticketStatusBadge(t);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { setTicketId(t.id); setPickerOpen(false); setTicketQuery(""); }}
                        className={cn(
                          "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                          isSel
                            ? "bg-violet-50 dark:bg-violet-900/20"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
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
                              <span className="text-[10px] text-slate-400 truncate">
                                · {t.ticketTypeName}
                              </span>
                            )}
                            {sb && (
                              <span className={cn("text-[9px] px-1 rounded", sb.cls)}>{sb.label}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {aboTickets.length === 0 && !selectedTicket && (
              <p className="text-[11px] text-slate-400">
                Es existieren noch keine Tickets mit Abo. Du kannst das Schließfach trotzdem anlegen und später verknüpfen.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="l-notes" className="text-xs inline-flex items-center gap-1">
              <FileText className="h-3 w-3 text-slate-400" />
              Notiz
            </Label>
            <Input
              id="l-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional, z. B. Schloss-Code"
              className="h-9"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 rounded-lg">{error}</p>
        )}

        <Separator className="dark:bg-slate-800" />

        <div className="flex items-center justify-between">
          {!isNew ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
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
