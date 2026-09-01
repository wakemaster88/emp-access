"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorLine, apiRequest } from "@/components/schliessanlage/shared";
import type { DoorRow, RoomRow } from "@/components/schliessanlage/types";

interface Props {
  door: DoorRow | null;
  defaultRoomId: number | null;
  rooms: RoomRow[];
  open: boolean;
  onClose: () => void;
}

export function DoorDialog({ door, defaultRoomId, rooms, open, onClose }: Props) {
  const router = useRouter();
  const isNew = !door;
  const [name, setName] = useState(door?.name ?? "");
  const [doorNumber, setDoorNumber] = useState(door?.doorNumber ?? "");
  const [roomId, setRoomId] = useState<number | null>(door?.roomId ?? defaultRoomId);
  const [notes, setNotes] = useState(door?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest(
      isNew ? "/api/schliessanlage/doors" : `/api/schliessanlage/doors/${door.id}`,
      isNew ? "POST" : "PUT",
      {
        name: name.trim(),
        roomId,
        doorNumber: doorNumber.trim() || null,
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
            {isNew ? "Neue Tür anlegen" : "Tür bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="d-name" className="text-xs">
              Bezeichnung <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="d-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Eingangstür"
              autoFocus
              className="h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="d-number" className="text-xs">
                Türnummer
              </Label>
              <Input
                id="d-number"
                value={doorNumber}
                onChange={(e) => setDoorNumber(e.target.value)}
                placeholder="T-14"
                className="h-9 font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="d-room" className="text-xs">
                Raum
              </Label>
              <select
                id="d-room"
                value={roomId ?? ""}
                onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="">— ohne Raum —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {[r.building, r.name].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-notes" className="text-xs">
              Notiz
            </Label>
            <Input
              id="d-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9"
            />
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
            disabled={saving || !name.trim()}
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
