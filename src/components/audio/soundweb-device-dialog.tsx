"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SOUNDWEB_DEFAULT_PORT, formatNode } from "@/lib/soundweb";
import type { SoundwebDeviceRow } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  device: SoundwebDeviceRow | null;
}

/** Prozessor anlegen oder bearbeiten: wie der Hub ihn erreicht. */
export function SoundwebDeviceDialog({ open, onClose, onSaved, device }: Props) {
  const isEdit = !!device;
  const [name, setName] = useState(device?.name ?? "");
  const [host, setHost] = useState(device?.host ?? "");
  const [port, setPort] = useState(String(device?.port ?? SOUNDWEB_DEFAULT_PORT));
  const [node, setNode] = useState(device ? formatNode(device.node) : "0x0001");
  const [isActive, setIsActive] = useState(device?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Name ist erforderlich");
    if (!host.trim()) return setError("IP-Adresse ist erforderlich");
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/audio/soundweb/${device!.id}` : "/api/audio/soundweb", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          host: host.trim(),
          port: port.trim(),
          node: node.trim(),
          isActive,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Soundweb bearbeiten" : "Soundweb hinzufügen"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="sw-name">Name</Label>
            <Input
              id="sw-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. BLU-100 Halle"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <div>
              <Label htmlFor="sw-host">IP-Adresse</Label>
              <Input
                id="sw-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.50"
                inputMode="decimal"
              />
            </div>
            <div>
              <Label htmlFor="sw-port">Port</Label>
              <Input
                id="sw-port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                inputMode="numeric"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="sw-node">HiQnet-Node</Label>
            <Input
              id="sw-node"
              value={node}
              onChange={(e) => setNode(e.target.value)}
              placeholder="0x0001"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Steht in Audio Architect im Netzwerkfenster beim Gerät und bildet die
              ersten vier Stellen jeder Objektadresse (0x<b>0001</b>03000100). Dezimal
              oder hex mit 0x.
            </p>
          </div>
          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border border-input p-3 dark:border-border">
              <div>
                <p className="text-sm font-medium">Aktiv</p>
                <p className="text-xs text-muted-foreground">
                  Aus: Der Hub baut die Verbindung ab, die Regler bleiben gespeichert.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Der lokale Hub verbindet sich über das London-DI-Protokoll (TCP {SOUNDWEB_DEFAULT_PORT}).
            Der Prozessor muss aus dem Netz des Hubs erreichbar sein; ein Passwort braucht er nicht.
          </p>
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={saving} className={cn("gap-1.5", saving && "opacity-80")}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
