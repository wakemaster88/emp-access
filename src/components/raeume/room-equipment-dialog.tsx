"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { EquipmentPicker, type EquipmentItem } from "@/components/schliessanlage/equipment-picker";
import { ErrorLine, apiRequest, deviceMetaLabel } from "@/components/raeume/shared";
import type { RoomCamera, RoomDevice } from "@/components/raeume/types";

export interface Placed<T> {
  item: T;
  roomId: number | null;
}

/**
 * Geraete und Kameras eines Raums zuordnen.
 *
 * Schreibt auf denselben Endpunkt wie die Schliessanlage – es ist derselbe
 * Raumdatensatz, nur eine andere Sicht darauf. Die Auswahl ersetzt vollstaendig.
 */
export function RoomEquipmentDialog({
  roomId,
  roomName,
  devices,
  cameras,
  roomNames,
  open,
  onClose,
}: {
  roomId: number;
  roomName: string;
  devices: Placed<RoomDevice>[];
  cameras: Placed<RoomCamera>[];
  roomNames: Map<number, string>;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [deviceIds, setDeviceIds] = useState<number[]>(
    () => devices.filter((d) => d.roomId === roomId).map((d) => d.item.id),
  );
  const [cameraIds, setCameraIds] = useState<number[]>(
    () => cameras.filter((c) => c.roomId === roomId).map((c) => c.item.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const takenBy = (otherRoomId: number | null) =>
    otherRoomId != null && otherRoomId !== roomId
      ? roomNames.get(otherRoomId) ?? "anderem Raum"
      : null;

  const deviceItems: EquipmentItem[] = devices.map((d) => ({
    id: d.item.id,
    label: d.item.name,
    meta: deviceMetaLabel(d.item.type, d.item.category),
    takenBy: takenBy(d.roomId),
  }));
  const cameraItems: EquipmentItem[] = cameras.map((c) => ({
    id: c.item.id,
    label: c.item.name,
    meta: c.item.kind,
    takenBy: takenBy(c.roomId),
  }));

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest(`/api/schliessanlage/rooms/${roomId}`, "PUT", {
      deviceIds,
      cameraIds,
    });
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{roomName}: Geräte und Kameras</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Geräte in diesem Raum</Label>
            <EquipmentPicker
              items={deviceItems}
              value={deviceIds}
              onChange={setDeviceIds}
              placeholder="Gerät suchen (Shelly, Nuki, Taster …)"
              emptyText="Noch keine Geräte angelegt."
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Kameras für diesen Raum</Label>
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
                Speichern
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
