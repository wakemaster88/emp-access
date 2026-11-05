"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { EquipmentPicker, type EquipmentItem } from "@/components/schliessanlage/equipment-picker";
import { ErrorLine, apiRequest, deviceMetaLabel } from "@/components/raeume/shared";
import type { NetworkItem, RoomCamera, RoomDevice, RoomZone, ScheduleOption } from "@/components/raeume/types";
import { ROOM_ICONS, roomIconKey } from "@/components/raeume/room-icons";
import { networkTypeLabel } from "@/components/raeume/network-widget";
import { cn } from "@/lib/utils";

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
  zones,
  roomNames,
  scheduleOptions,
  currentScheduleId,
  roomIcon,
  network,
  open,
  onClose,
}: {
  roomId: number;
  roomName: string;
  devices: Placed<RoomDevice>[];
  cameras: Placed<RoomCamera>[];
  zones: Placed<RoomZone>[];
  roomNames: Map<number, string>;
  scheduleOptions: ScheduleOption[];
  currentScheduleId: number | null;
  roomIcon: string | null;
  network: NetworkItem[];
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
  const [audioZoneIds, setAudioZoneIds] = useState<number[]>(
    () => zones.filter((z) => z.roomId === roomId).map((z) => z.item.id),
  );
  const [scheduleId, setScheduleId] = useState<number | null>(currentScheduleId);
  const [name, setName] = useState(roomName);
  const [icon, setIcon] = useState<string>(roomIconKey({ name: roomName, icon: roomIcon }));
  // Netzwerk: Infrastruktur und Endgeraete in einer Liste; gerade Ids =
  // NetworkDevice, ungerade = NetworkClient.
  const netId = (n: NetworkItem) => n.id * 2 + (n.kind === "client" ? 1 : 0);
  const [networkIds, setNetworkIds] = useState<number[]>(
    () => network.filter((n) => n.roomId === roomId).map(netId),
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
  const zoneItems: EquipmentItem[] = zones.map((z) => ({
    id: z.item.id,
    label: z.item.name,
    meta: z.item.hasPlayer ? "Beschallungszone" : "Beschallungszone · ohne Abspieler",
    takenBy: takenBy(z.roomId),
  }));

  const networkItems: EquipmentItem[] = network.map((n) => ({
    id: netId(n),
    label: n.name,
    meta: [networkTypeLabel(n.type), n.ipAddress].filter(Boolean).join(" · "),
    takenBy: takenBy(n.roomId),
  }));

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest(`/api/schliessanlage/rooms/${roomId}`, "PUT", {
      deviceIds,
      cameraIds,
      audioZoneIds,
      networkDeviceIds: networkIds.filter((id) => id % 2 === 0).map((id) => id / 2),
      networkClientIds: networkIds.filter((id) => id % 2 === 1).map((id) => (id - 1) / 2),
      operatingScheduleId: scheduleId,
      ...(name.trim() && name.trim() !== roomName ? { name: name.trim() } : {}),
      icon,
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">Raum bearbeiten</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Name des Raums" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Symbol</Label>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
              {ROOM_ICONS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={icon === key}
                  onClick={() => setIcon(key)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-xl border transition",
                    icon === key
                      ? "border-transparent bg-gradient-to-br from-primary to-violet-500 text-white shadow-md"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Betriebszeit</Label>
            <NativeSelect
              value={scheduleId ?? ""}
              onChange={(e) => setScheduleId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Betriebszeit"
            >
              <option value="">keine – Raum gilt als dauerhaft verfügbar</option>
              {scheduleOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.isDefault ? " (Vorbelegung)" : ""}
                </option>
              ))}
            </NativeSelect>
            {scheduleOptions.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Noch keine Betriebszeit angelegt – unter „Betriebszeiten“ anlegen.
              </p>
            )}
          </div>

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

          <div className="space-y-1">
            <Label className="text-xs">Beschallung in diesem Raum</Label>
            <EquipmentPicker
              items={zoneItems}
              value={audioZoneIds}
              onChange={setAudioZoneIds}
              placeholder="Zone suchen…"
              emptyText="Noch keine Beschallungszone angelegt – unter „Audio“ anlegen."
            />
            <p className="text-[11px] text-muted-foreground">
              Zonen im Raum richten sich mit „Betriebsbeginn“ und „Betriebsende“ nach der
              Betriebszeit dieses Raums.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Netzwerk in diesem Raum</Label>
            <EquipmentPicker
              items={networkItems}
              value={networkIds}
              onChange={setNetworkIds}
              placeholder="Switch, Access Point, Drucker, Kasse …"
              emptyText="Noch keine Netzwerkgeräte erfasst."
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
            className="h-8 min-w-24"
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
