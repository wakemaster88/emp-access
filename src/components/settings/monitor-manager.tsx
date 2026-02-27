"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus, Trash2, Copy, Check, ExternalLink, Monitor,
  Loader2, Pencil, Wifi, WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Device {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
}

interface MonitorConfigData {
  id: number;
  name: string;
  token: string;
  deviceIds: number[];
  isActive: boolean;
  createdAt: string;
}

interface MonitorManagerProps {
  monitors: MonitorConfigData[];
  devices: Device[];
  baseUrl: string;
}

function MonitorDialog({
  monitor,
  devices,
  baseUrl,
  onClose,
}: {
  monitor: MonitorConfigData | null;
  devices: Device[];
  baseUrl: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const isNew = !monitor;
  const [name, setName] = useState(monitor?.name ?? "");
  const [selectedDevices, setSelectedDevices] = useState<number[]>(monitor?.deviceIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleDevice(id: number) {
    setSelectedDevices((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const url = isNew ? "/api/monitors" : `/api/monitors/${monitor!.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), deviceIds: selectedDevices }),
      });
      if (!res.ok) {
        setError("Fehler beim Speichern");
      } else {
        onClose();
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  const monitorUrl = monitor ? `${baseUrl}/monitor/${monitor.token}` : "";

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isNew ? "Neuen Monitor erstellen" : "Monitor bearbeiten"}</DialogTitle>
      </DialogHeader>

      <form onSubmit={handleSave} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="m-name">Name <span className="text-rose-500">*</span></Label>
          <Input
            id="m-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Eingang Monitor, Aquapark Live"
            required
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label>Geräte auswählen</Label>
          <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
            {devices.length === 0 && (
              <p className="text-sm text-slate-500">Keine Geräte vorhanden</p>
            )}
            {devices.map((device) => {
              const selected = selectedDevices.includes(device.id);
              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => toggleDevice(device.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
                    selected
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                      : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                    selected ? "bg-indigo-600 border-indigo-600" : "border-slate-300 dark:border-slate-600"
                  )}>
                    {selected && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{device.name}</p>
                    <p className="text-xs text-slate-400">{device.type === "RASPBERRY_PI" ? "Raspberry Pi" : "Shelly"}</p>
                  </div>
                  {device.isActive
                    ? <Wifi className="h-4 w-4 text-emerald-500 shrink-0" />
                    : <WifiOff className="h-4 w-4 text-slate-400 shrink-0" />}
                </button>
              );
            })}
          </div>
          {selectedDevices.length > 0 && (
            <p className="text-xs text-slate-500">{selectedDevices.length} Gerät(e) ausgewählt</p>
          )}
        </div>

        {!isNew && (
          <div className="space-y-1.5">
            <Label>Monitor-URL</Label>
            <div className="flex items-start gap-4 flex-wrap">
              <MonitorUrlQr url={monitorUrl} />
              <div className="flex-1 min-w-0 space-y-1">
                <CopyUrl url={monitorUrl} />
                <p className="text-xs text-slate-400">Diese URL ist öffentlich zugänglich — kein Login erforderlich. QR-Code mit dem Handy scannen, um den Monitor zu öffnen.</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
        )}

        <Separator className="dark:bg-slate-800" />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" disabled={saving || !name.trim()} className="bg-indigo-600 hover:bg-indigo-700 min-w-28">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isNew ? "Erstellen" : "Speichern"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

const QR_SIZE = 96;

function MonitorUrlQr({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!url || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: QR_SIZE,
      margin: 1,
      color: { dark: "#1e293b", light: "#ffffff" },
    });
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <canvas ref={canvasRef} width={QR_SIZE} height={QR_SIZE} className="rounded border border-slate-200 dark:border-slate-700 bg-white" aria-hidden />
      <span className="text-xs text-slate-500">Link zum Scannen</span>
    </div>
  );
}

function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex gap-2">
      <Input value={url} readOnly className="font-mono text-xs bg-slate-50 dark:bg-slate-900" />
      <Button type="button" variant="outline" size="icon" onClick={copy} className="shrink-0">
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      </Button>
      <Button type="button" variant="outline" size="icon" asChild className="shrink-0">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4" />
        </a>
      </Button>
    </div>
  );
}

export function MonitorManager({ monitors, devices, baseUrl }: MonitorManagerProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<MonitorConfigData | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  async function handleDelete(monitor: MonitorConfigData) {
    if (!confirm(`Monitor "${monitor.name}" wirklich löschen?`)) return;
    setDeleting(monitor.id);
    try {
      await fetch(`/api/monitors/${monitor.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      {monitors.length === 0 && (
        <Card className="border-slate-200 dark:border-slate-800 border-dashed">
          <CardContent className="py-8 text-center">
            <Monitor className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Noch kein Monitor erstellt.</p>
            <p className="text-xs text-slate-400 mt-1">Erstelle einen öffentlichen Monitor für ausgewählte Geräte.</p>
          </CardContent>
        </Card>
      )}

      {monitors.map((monitor) => {
        const url = `${baseUrl}/monitor/${monitor.token}`;
        const deviceNames = devices
          .filter((d) => (monitor.deviceIds as number[]).includes(d.id))
          .map((d) => d.name);

        return (
          <Card key={monitor.id} className="border-slate-200 dark:border-slate-800">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-indigo-500 shrink-0" />
                    <span className="font-medium text-slate-900 dark:text-slate-100">{monitor.name}</span>
                    <Badge className={monitor.isActive
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs"
                      : "bg-slate-100 text-slate-500 text-xs"}>
                      {monitor.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </div>

                  {deviceNames.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {deviceNames.map((n) => (
                        <Badge key={n} variant="secondary" className="text-xs font-normal">{n}</Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-start gap-4 flex-wrap">
                    <MonitorUrlQr url={url} />
                    <div className="flex-1 min-w-0 space-y-1">
                      <CopyUrl url={url} />
                    </div>
                  </div>
                </div>

                <div className="flex gap-1 shrink-0">
                  <Dialog open={editing?.id === monitor.id} onOpenChange={(o) => { if (!o) setEditing(null); }}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-700" onClick={() => setEditing(monitor)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    {editing?.id === monitor.id && (
                      <MonitorDialog
                        monitor={editing}
                        devices={devices}
                        baseUrl={baseUrl}
                        onClose={() => setEditing(null)}
                      />
                    )}
                  </Dialog>

                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-rose-500"
                    onClick={() => handleDelete(monitor)}
                    disabled={deleting === monitor.id}
                  >
                    {deleting === monitor.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full gap-2 border-dashed">
            <Plus className="h-4 w-4" />
            Monitor erstellen
          </Button>
        </DialogTrigger>
        <MonitorDialog
          monitor={null}
          devices={devices}
          baseUrl={baseUrl}
          onClose={() => setAddOpen(false)}
        />
      </Dialog>
    </div>
  );
}
