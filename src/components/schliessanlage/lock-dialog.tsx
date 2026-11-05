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
import {
  ErrorLine,
  apiRequest,
  canOpenLock,
  deviceMetaLabel,
  isoToDateInput,
} from "@/components/schliessanlage/shared";
import type { DeviceOption, LockRow } from "@/components/schliessanlage/types";
import { LOCK_TYPE_LABELS } from "@/lib/keying";

interface Props {
  lock: LockRow | null;
  doorId: number;
  devices: DeviceOption[];
  open: boolean;
  onClose: () => void;
}

export function LockDialog({ lock, doorId, devices, open, onClose }: Props) {
  const router = useRouter();
  const isNew = !lock;
  const [lockNumber, setLockNumber] = useState(lock?.lockNumber ?? "");
  const [lockType, setLockType] = useState(lock?.lockType ?? "CYLINDER");
  const [system, setSystem] = useState(lock?.system ?? "");
  const [manufacturer, setManufacturer] = useState(lock?.manufacturer ?? "");
  const [installedAt, setInstalledAt] = useState(isoToDateInput(lock?.installedAt ?? null));
  const [notes, setNotes] = useState(lock?.notes ?? "");
  const [deviceId, setDeviceId] = useState(lock?.deviceId ? String(lock.deviceId) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Smart Locks und Tür-Shellys zuerst, der Rest bleibt für Sonderfälle wählbar.
  const [preferred, others] = devices.reduce<[DeviceOption[], DeviceOption[]]>(
    (acc, d) => {
      acc[canOpenLock(d.type, d.category) ? 0 : 1].push(d);
      return acc;
    },
    [[], []],
  );

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
        deviceId: deviceId ? Number(deviceId) : null,
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
            {isNew ? "Schloss hinzufügen" : "Schloss bearbeiten"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Handy eine Spalte, sonst schneidet das Bauart-Auswahlfeld lange Werte ab. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
            <div className="space-y-1">
              <Label htmlFor="k-number">
                Schließungsnummer
              </Label>
              <Input
                id="k-number"
                value={lockNumber}
                onChange={(e) => setLockNumber(e.target.value)}
                placeholder="z. B. 41.03"
                autoFocus
                className="font-mono max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="k-type">
                Bauart
              </Label>
              <NativeSelect
                id="k-type"
                value={lockType}
                onChange={(e) => setLockType(e.target.value)}
                className="max-sm:h-11"
              >
                {Object.entries(LOCK_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="k-system">
                Schließsystem
              </Label>
              <Input
                id="k-system"
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                placeholder="Hauptanlage 2024"
                className="max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="k-manufacturer">
                Hersteller
              </Label>
              <Input
                id="k-manufacturer"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                className="max-sm:h-11"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="k-installed">
                Eingebaut am
              </Label>
              <Input
                id="k-installed"
                type="date"
                value={installedAt}
                onChange={(e) => setInstalledAt(e.target.value)}
                className="max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="k-notes">
                Notiz
              </Label>
              <Input
                id="k-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="max-sm:h-11"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="k-device">
              Elektronisches Gerät
            </Label>
            <NativeSelect
              id="k-device"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="max-sm:h-11"
            >
              <option value="">Rein mechanisch</option>
              {preferred.length > 0 && (
                <optgroup label="Smart Locks & Türsteuerung">
                  {preferred.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({deviceMetaLabel(d.type, d.category)})
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Weitere Geräte">
                  {others.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({deviceMetaLabel(d.type, d.category)})
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
            <p className="text-[11px] text-muted-foreground">
              Nuki, LOQED oder ein Shelly am Türöffner, der diesen Schließpunkt öffnet.
            </p>
          </div>
          <ErrorLine message={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving}
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
