"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LockPicker } from "@/components/schliessanlage/lock-picker";
import { ErrorLine, apiRequest } from "@/components/schliessanlage/shared";
import type { KeyRow, LockOption } from "@/components/schliessanlage/types";
import { KEY_LEVEL_LABELS, KEY_STATUS_LABELS } from "@/lib/keying";

interface Props {
  keyItem: KeyRow | null;
  lockOptions: LockOption[];
  open: boolean;
  onClose: () => void;
}

export function KeyDialog({ keyItem, lockOptions, open, onClose }: Props) {
  const router = useRouter();
  const isNew = !keyItem;
  const [keyNumber, setKeyNumber] = useState(keyItem?.keyNumber ?? "");
  const [label, setLabel] = useState(keyItem?.label ?? "");
  const [level, setLevel] = useState(keyItem?.level ?? "SINGLE");
  const [status, setStatus] = useState(keyItem?.status ?? "AVAILABLE");
  const [notes, setNotes] = useState(keyItem?.notes ?? "");
  const [lockIds, setLockIds] = useState<number[]>(keyItem?.lockIds ?? []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const isIssued = keyItem?.status === "ISSUED";

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest(
      isNew ? "/api/schliessanlage/keys" : `/api/schliessanlage/keys/${keyItem.id}`,
      isNew ? "POST" : "PUT",
      {
        keyNumber: keyNumber.trim(),
        label: label.trim() || null,
        level,
        // Ausgegebene Schlüssel kommen nur über die Rücknahme zurück in den
        // Bestand – der Status bleibt hier unangetastet.
        ...(isIssued ? {} : { status }),
        notes: notes.trim() || null,
        lockIds,
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

  async function remove() {
    if (!keyItem) return;
    if (
      !confirm(
        `Schlüssel "${keyItem.keyNumber}" wirklich löschen? Mit vorhandener Protokoll-Historie wird er stattdessen als vernichtet markiert.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    const res = await apiRequest(`/api/schliessanlage/keys/${keyItem.id}`, "DELETE");
    setDeleting(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isNew ? "Neuen Schlüssel anlegen" : `Schlüssel ${keyItem.keyNumber}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="s-number" className="text-xs">
                Schlüsselnummer <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="s-number"
                value={keyNumber}
                onChange={(e) => setKeyNumber(e.target.value)}
                placeholder="z. B. GHS-01"
                autoFocus
                className="h-9 font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-label" className="text-xs">
                Bezeichnung
              </Label>
              <Input
                id="s-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z. B. Hausmeister"
                className="h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="s-level" className="text-xs">
                Schlüsselart
              </Label>
              <select
                id="s-level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                {Object.entries(KEY_LEVEL_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-status" className="text-xs">
                Status
              </Label>
              <select
                id="s-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={isIssued}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
              >
                {Object.entries(KEY_STATUS_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
              {isIssued && (
                <p className="text-[10px] text-slate-400">
                  Ausgegeben – Rücknahme läuft über das Protokoll.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Schließt folgende Schlösser</Label>
            <LockPicker options={lockOptions} value={lockIds} onChange={setLockIds} />
            {level === "GRAND" && lockIds.length === 0 && (
              <p className="text-[10px] text-amber-600">
                Ein Generalschlüssel ohne zugeordnete Schlösser sperrt nichts.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="s-notes" className="text-xs">
              Notiz
            </Label>
            <Input
              id="s-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9"
            />
          </div>

          <ErrorLine message={error} />
        </div>

        <Separator className="dark:bg-slate-800" />

        <div className="flex items-center justify-between">
          {!isNew ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={saving || deleting}
              className="h-8 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/20"
            >
              {deleting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3.5 w-3.5" />
              )}
              Löschen
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="h-8">
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={saving || deleting || !keyNumber.trim()}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
