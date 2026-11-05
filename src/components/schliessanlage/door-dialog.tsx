"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
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
          <DialogTitle>
            {isNew ? "Neue Tür anlegen" : "Tür bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="d-name">
              Bezeichnung <span className="text-destructive">*</span>
            </Label>
            <Input
              id="d-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Eingangstür"
              autoFocus
              className="max-sm:h-11"
            />
          </div>
          {/* Handy eine Spalte, sonst schneidet das Raum-Auswahlfeld den Raumnamen ab. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
            <div className="space-y-1">
              <Label htmlFor="d-number">
                Türnummer
              </Label>
              <Input
                id="d-number"
                value={doorNumber}
                onChange={(e) => setDoorNumber(e.target.value)}
                placeholder="T-14"
                className="font-mono max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="d-room">
                Raum
              </Label>
              <NativeSelect
                id="d-room"
                value={roomId ?? ""}
                onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : null)}
                className="max-sm:h-11"
              >
                <option value="">— ohne Raum —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {[r.building, r.name].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-notes">
              Notiz
            </Label>
            <Input
              id="d-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="max-sm:h-11"
            />
          </div>
          <ErrorLine message={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving || !name.trim()}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
