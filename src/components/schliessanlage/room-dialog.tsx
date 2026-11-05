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
import { EquipmentPicker, type EquipmentItem } from "@/components/schliessanlage/equipment-picker";
import { ErrorLine, apiRequest, deviceMetaLabel } from "@/components/schliessanlage/shared";
import type { CameraOption, DeviceOption, RoomRow } from "@/components/schliessanlage/types";

interface Props {
  room: RoomRow | null;
  devices: DeviceOption[];
  cameras: CameraOption[];
  /** Raumnamen je ID – zeigt an, wo ein Gerät aktuell hängt. */
  roomNames: Map<number, string>;
  open: boolean;
  onClose: () => void;
}

export function RoomDialog({ room, devices, cameras, roomNames, open, onClose }: Props) {
  const router = useRouter();
  const isNew = !room;
  const [name, setName] = useState(room?.name ?? "");
  const [number, setNumber] = useState(room?.number ?? "");
  const [building, setBuilding] = useState(room?.building ?? "");
  const [floor, setFloor] = useState(room?.floor ?? "");
  const [notes, setNotes] = useState(room?.notes ?? "");
  const [deviceIds, setDeviceIds] = useState<number[]>(
    () => devices.filter((d) => room && d.roomId === room.id).map((d) => d.id),
  );
  const [cameraIds, setCameraIds] = useState<number[]>(
    () => cameras.filter((c) => room && c.roomId === room.id).map((c) => c.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const takenBy = (roomId: number | null) =>
    roomId != null && roomId !== room?.id ? roomNames.get(roomId) ?? "anderem Raum" : null;

  const deviceItems: EquipmentItem[] = devices.map((d) => ({
    id: d.id,
    label: d.name,
    meta: deviceMetaLabel(d.type, d.category),
    takenBy: takenBy(d.roomId),
  }));
  const cameraItems: EquipmentItem[] = cameras.map((c) => ({
    id: c.id,
    label: c.name,
    meta: c.kind,
    takenBy: takenBy(c.roomId),
  }));

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest(
      isNew ? "/api/schliessanlage/rooms" : `/api/schliessanlage/rooms/${room.id}`,
      isNew ? "POST" : "PUT",
      {
        name: name.trim(),
        number: number.trim() || null,
        building: building.trim() || null,
        floor: floor.trim() || null,
        notes: notes.trim() || null,
        deviceIds,
        cameraIds,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Neuen Raum anlegen" : "Raum bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="r-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="r-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Technikraum"
              autoFocus
              className="max-sm:h-11"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="r-number">
                Raumnummer
              </Label>
              <Input
                id="r-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="1.03"
                className="font-mono max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-building">
                Gebäude
              </Label>
              <Input
                id="r-building"
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                placeholder="Haupthaus"
                className="max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-floor">
                Etage
              </Label>
              <Input
                id="r-floor"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="EG"
                className="max-sm:h-11"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-notes">
              Notiz
            </Label>
            <Input
              id="r-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="max-sm:h-11"
            />
          </div>

          <div className="space-y-1">
            <Label>Geräte in diesem Raum</Label>
            <EquipmentPicker
              items={deviceItems}
              value={deviceIds}
              onChange={setDeviceIds}
              placeholder="Gerät suchen (Shelly, Nuki, Taster …)"
              emptyText="Noch keine Geräte angelegt."
            />
          </div>

          <div className="space-y-1">
            <Label>Kameras für diesen Raum</Label>
            <EquipmentPicker
              items={cameraItems}
              value={cameraIds}
              onChange={setCameraIds}
              placeholder="Kamera suchen…"
              emptyText="Noch keine Kameras angelegt."
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
