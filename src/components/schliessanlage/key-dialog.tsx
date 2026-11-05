"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Neuen Schlüssel anlegen" : `Schlüssel ${keyItem.keyNumber}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="s-number">
                Schlüsselnummer <span className="text-destructive">*</span>
              </Label>
              <Input
                id="s-number"
                value={keyNumber}
                onChange={(e) => setKeyNumber(e.target.value)}
                placeholder="z. B. GHS-01"
                autoFocus
                className="font-mono max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-label">
                Bezeichnung
              </Label>
              <Input
                id="s-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z. B. Hausmeister"
                className="max-sm:h-11"
              />
            </div>
          </div>

          {/* Handy eine Spalte, sonst schneiden die Auswahlfelder „Gruppenschlüssel“ und „Generalschlüssel“ ab. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
            <div className="space-y-1">
              <Label htmlFor="s-level">
                Schlüsselart
              </Label>
              <NativeSelect
                id="s-level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="max-sm:h-11"
              >
                {Object.entries(KEY_LEVEL_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-status">
                Status
              </Label>
              <NativeSelect
                id="s-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={isIssued}
                className="max-sm:h-11"
              >
                {Object.entries(KEY_STATUS_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </NativeSelect>
              {isIssued && (
                <p className="text-[11px] text-muted-foreground">
                  Ausgegeben – Rücknahme läuft über das Protokoll.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Schließt folgende Schlösser</Label>
            <LockPicker options={lockOptions} value={lockIds} onChange={setLockIds} />
            {level === "GRAND" && lockIds.length === 0 && (
              <p className="text-[11px] text-warning">
                Ein Generalschlüssel ohne zugeordnete Schlösser sperrt nichts.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="s-notes">
              Notiz
            </Label>
            <Input
              id="s-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="max-sm:h-11"
            />
          </div>

          <ErrorLine message={error} />

          {/* Löschen als Schritt im selben Dialog statt Browser-Rückfrage, keine zweite Ebene (docs/design-regeln.md, Abschnitt 18). */}
          {confirmDelete && keyItem && (
            <Notice tone="warning" compact title={`Schlüssel "${keyItem.keyNumber}" wirklich löschen?`}>
              Mit vorhandener Protokoll-Historie wird er stattdessen als vernichtet markiert.
            </Notice>
          )}
        </div>

        <Separator />

        {/* Löschen ab sm links (DialogFooter start), Abbrechen und Speichern rechts; auf dem Handy untereinander, Primärtaste oben, Löschen zuunterst. */}
        <DialogFooter
          start={
            !isNew &&
            !confirmDelete && (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive max-sm:h-11"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Löschen
              </Button>
            )
          }
        >
          {confirmDelete ? (
            <>
              <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting} className="max-sm:h-11">
                Abbrechen
              </Button>
              <Button variant="destructive" onClick={remove} disabled={deleting} className="min-w-24 max-sm:h-11">
                {deleting ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                )}
                Löschen
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
                Abbrechen
              </Button>
              <Button
                onClick={save}
                disabled={saving || deleting || !keyNumber.trim()}
                className="min-w-24 max-sm:h-11"
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
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
