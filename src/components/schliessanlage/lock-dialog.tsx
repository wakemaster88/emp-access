"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorLine, apiRequest, isoToDateInput } from "@/components/schliessanlage/shared";
import type { LockRow } from "@/components/schliessanlage/types";
import { LOCK_TYPE_LABELS } from "@/lib/keying";

interface Props {
  lock: LockRow | null;
  doorId: number;
  open: boolean;
  onClose: () => void;
}

export function LockDialog({ lock, doorId, open, onClose }: Props) {
  const router = useRouter();
  const isNew = !lock;
  const [lockNumber, setLockNumber] = useState(lock?.lockNumber ?? "");
  const [lockType, setLockType] = useState(lock?.lockType ?? "CYLINDER");
  const [system, setSystem] = useState(lock?.system ?? "");
  const [manufacturer, setManufacturer] = useState(lock?.manufacturer ?? "");
  const [installedAt, setInstalledAt] = useState(isoToDateInput(lock?.installedAt ?? null));
  const [notes, setNotes] = useState(lock?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest(
      isNew ? "/api/schliessanlage/locks" : `/api/schliessanlage/locks/${lock.id}`,
      isNew ? "POST" : "PUT",
      {
        doorId,
        lockNumber: lockNumber.trim() || null,
        lockType,
        system: system.trim() || null,
        manufacturer: manufacturer.trim() || null,
        installedAt: installedAt || null,
        notes: notes.trim() || null,
      },
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isNew ? "Schloss hinzufügen" : "Schloss bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="k-number" className="text-xs">
                Schließungsnummer
              </Label>
              <Input
                id="k-number"
                value={lockNumber}
                onChange={(e) => setLockNumber(e.target.value)}
                placeholder="z. B. 41.03"
                autoFocus
                className="h-9 font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="k-type" className="text-xs">
                Bauart
              </Label>
              <select
                id="k-type"
                value={lockType}
                onChange={(e) => setLockType(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                {Object.entries(LOCK_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="k-system" className="text-xs">
                Schließsystem
              </Label>
              <Input
                id="k-system"
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                placeholder="Hauptanlage 2024"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="k-manufacturer" className="text-xs">
                Hersteller
              </Label>
              <Input
                id="k-manufacturer"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="k-installed" className="text-xs">
                Eingebaut am
              </Label>
              <Input
                id="k-installed"
                type="date"
                value={installedAt}
                onChange={(e) => setInstalledAt(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="k-notes" className="text-xs">
                Notiz
              </Label>
              <Input
                id="k-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <ErrorLine message={error} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="h-8">
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving}
            className="h-8 min-w-24 bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Save className="mr-1 h-3.5 w-3.5" />
                {isNew ? "Erstellen" : "Speichern"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
