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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Trash2, Save, Lock, MapPin, Hash, CreditCard, FileText,
} from "lucide-react";

export interface LockerData {
  id: number;
  name: string;
  number: string;
  location: string | null;
  notes: string | null;
  subscriptionId: number | null;
}

interface SubscriptionRef {
  id: number;
  name: string;
}

interface LockerDialogProps {
  locker: LockerData | null;
  subscriptions: SubscriptionRef[];
  open: boolean;
  onClose: () => void;
}

const NONE_VALUE = "__none__";

export function LockerDialog({ locker, subscriptions, open, onClose }: LockerDialogProps) {
  const router = useRouter();
  const isNew = !locker;
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [subscriptionId, setSubscriptionId] = useState<string>(NONE_VALUE);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      if (locker) {
        setName(locker.name);
        setNumber(locker.number);
        setLocation(locker.location ?? "");
        setNotes(locker.notes ?? "");
        setSubscriptionId(locker.subscriptionId ? String(locker.subscriptionId) : NONE_VALUE);
      } else {
        setName("");
        setNumber("");
        setLocation("");
        setNotes("");
        setSubscriptionId(NONE_VALUE);
      }
    }
  }, [open, locker]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        number: number.trim(),
        location: location.trim() || null,
        notes: notes.trim() || null,
        subscriptionId: subscriptionId === NONE_VALUE ? null : Number(subscriptionId),
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
                placeholder="z. B. Spind 12 oder Mieter-Name"
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
            <Label htmlFor="l-sub" className="text-xs inline-flex items-center gap-1">
              <CreditCard className="h-3 w-3 text-slate-400" />
              Verknüpftes Abo
            </Label>
            <Select value={subscriptionId} onValueChange={setSubscriptionId}>
              <SelectTrigger id="l-sub" className="h-9">
                <SelectValue placeholder="Kein Abo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Kein Abo —</SelectItem>
                {subscriptions.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {subscriptions.length === 0 && (
              <p className="text-[11px] text-slate-400">
                Noch keine Abos vorhanden. Du kannst das Schließfach trotzdem anlegen und später verknüpfen.
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
              placeholder="Optional"
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
