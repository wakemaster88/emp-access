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
  Loader2, Pencil, Wifi, WifiOff, QrCode, ClipboardCheck, LayoutGrid, ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Device {
  id: number;
  name: string;
  type: string;
  category: "DREHKREUZ" | "TUER" | "SENSOR" | "SCHALTER" | "BELEUCHTUNG" | null;
  isActive: boolean;
}

interface MonitorConfigData {
  id: number;
  name: string;
  token: string;
  type: string;
  deviceIds: number[];
  areaIds: number[];
  isActive: boolean;
  createdAt: string;
}

interface AccessAreaItem {
  id: number;
  name: string;
}

interface MonitorManagerProps {
  monitors: MonitorConfigData[];
  devices: Device[];
  accessAreas: AccessAreaItem[];
  baseUrl: string;
}

function MonitorDialog({
  monitor,
  devices,
  accessAreas,
  baseUrl,
  onClose,
}: {
  monitor: MonitorConfigData | null;
  devices: Device[];
  accessAreas: AccessAreaItem[];
  baseUrl: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const isNew = !monitor;
  const [name, setName] = useState(monitor?.name ?? "");
  const [type, setType] = useState(monitor?.type ?? "MONITOR");
  const [selectedDevices, setSelectedDevices] = useState<number[]>(monitor?.deviceIds ?? []);
  const [selectedAreas, setSelectedAreas] = useState<number[]>(monitor?.areaIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleDevice(id: number) {
    setSelectedDevices((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  }

  function toggleArea(id: number) {
    setSelectedAreas((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
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
        body: JSON.stringify({
          name: name.trim(),
          type,
          deviceIds: selectedDevices,
          areaIds: type === "MONITOR" ? selectedAreas : [],
        }),
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

  const urlPath =
    type === "CHECKIN"
      ? "checkin"
      : type === "RESOURCE_MONITOR"
        ? "resource-monitor"
        : type === "SCANNER"
          ? "scanner"
          : "monitor";
  const monitorUrl = monitor ? `${baseUrl}/${urlPath}/${monitor.token}` : "";

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
          <Label>Typ</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("MONITOR")}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all",
                type === "MONITOR"
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                  : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
              )}
            >
              <Monitor className={cn("h-4 w-4 shrink-0", type === "MONITOR" ? "text-indigo-600" : "text-slate-400")} />
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Scan-Monitor</p>
                <p className="text-xs text-slate-400">Live-Scans</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setType("CHECKIN")}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all",
                type === "CHECKIN"
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                  : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
              )}
            >
              <ClipboardCheck className={cn("h-4 w-4 shrink-0", type === "CHECKIN" ? "text-emerald-600" : "text-slate-400")} />
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Check-in</p>
                <p className="text-xs text-slate-400">Gäste einchecken</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setType("RESOURCE_MONITOR")}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all",
                type === "RESOURCE_MONITOR"
                  ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30"
                  : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
              )}
            >
              <LayoutGrid className={cn("h-4 w-4 shrink-0", type === "RESOURCE_MONITOR" ? "text-sky-600" : "text-slate-400")} />
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Ressourcen</p>
                <p className="text-xs text-slate-400">Tagesübersicht</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setType("SCANNER")}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all",
                type === "SCANNER"
                  ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                  : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
              )}
            >
              <ScanLine className={cn("h-4 w-4 shrink-0", type === "SCANNER" ? "text-amber-600" : "text-slate-400")} />
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Scanner</p>
                <p className="text-xs text-slate-400">QR-Kamera, Token</p>
              </div>
            </button>
          </div>
        </div>

        {type === "CHECKIN" && <div className="space-y-2">
          <Label>Tür-Schnellzugriff</Label>
          <p className="text-xs text-slate-400">
            Ausgewählte Türen erscheinen als direkter Button im Header des Check-in Monitors. Alle übrigen Türen / Drehkreuze sind weiterhin über das &bdquo;Mehr Türen&ldquo;-Menü erreichbar.
          </p>
          <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
            {devices.filter((d) => d.category === "TUER" || d.category === "DREHKREUZ").length === 0 && (
              <p className="text-sm text-slate-500">Keine Türen / Drehkreuze vorhanden. Setze die Kategorie eines Gerätes auf Tür oder Drehkreuz.</p>
            )}
            {devices
              .filter((d) => d.category === "TUER" || d.category === "DREHKREUZ")
              .map((device) => {
                const selected = selectedDevices.includes(device.id);
                return (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => toggleDevice(device.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
                      selected
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                    )}
                  >
                    <div className={cn(
                      "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                      selected ? "bg-emerald-600 border-emerald-600" : "border-slate-300 dark:border-slate-600"
                    )}>
                      {selected && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{device.name}</p>
                      <p className="text-xs text-slate-400">{device.category === "DREHKREUZ" ? "Drehkreuz" : "Tür"}</p>
                    </div>
                    {device.isActive
                      ? <Wifi className="h-4 w-4 text-emerald-500 shrink-0" />
                      : <WifiOff className="h-4 w-4 text-slate-400 shrink-0" />}
                  </button>
                );
              })}
          </div>
          {selectedDevices.length > 0 && (
            <p className="text-xs text-slate-500">{selectedDevices.length} Tür(en) als Schnellzugriff</p>
          )}
        </div>}

        {(type === "MONITOR" || type === "SCANNER") && <div className="space-y-2">
          <Label>Geräte auswählen</Label>
          {type === "SCANNER" && (
            <p className="text-xs text-slate-400">
              Optional: Das erste ausgewählte Gerät wird als Scan-Quelle in der Historie hinterlegt.
            </p>
          )}
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
        </div>}

        {type === "MONITOR" && <div className="space-y-2">
          <Label>Bereiche (optional)</Label>
          <p className="text-xs text-slate-400">
            Grenzt die Personen-/Ticketliste auf diese Bereiche ein – nützlich für Bereiche <span className="font-medium">ohne eigenes Scan-Gerät</span> (z.B. Seilbahn B, Übungslift). Ohne Auswahl gelten die Bereiche der ausgewählten Geräte.
          </p>
          <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
            {accessAreas.length === 0 && (
              <p className="text-sm text-slate-500">Keine Bereiche vorhanden</p>
            )}
            {accessAreas.map((area) => {
              const selected = selectedAreas.includes(area.id);
              return (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => toggleArea(area.id)}
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
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{area.name}</p>
                  </div>
                </button>
              );
            })}
          </div>
          {selectedAreas.length > 0 && (
            <p className="text-xs text-slate-500">{selectedAreas.length} Bereich(e) als Filter</p>
          )}
        </div>}

        {type === "RESOURCE_MONITOR" && <div className="space-y-2">
          <Label>Bereiche auswählen</Label>
          <p className="text-xs text-slate-400">Wähle die Bereiche, die im Ressourcen-Monitor angezeigt werden. Ohne Auswahl werden alle Dashboard-Bereiche verwendet.</p>
          <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
            {accessAreas.length === 0 && (
              <p className="text-sm text-slate-500">Keine Bereiche vorhanden</p>
            )}
            {accessAreas.map((area) => {
              const selected = selectedDevices.includes(area.id);
              return (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => toggleDevice(area.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
                    selected
                      ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30"
                      : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                    selected ? "bg-sky-600 border-sky-600" : "border-slate-300 dark:border-slate-600"
                  )}>
                    {selected && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{area.name}</p>
                  </div>
                </button>
              );
            })}
          </div>
          {selectedDevices.length > 0 && (
            <p className="text-xs text-slate-500">{selectedDevices.length} Bereich(e) ausgewählt</p>
          )}
        </div>}

        {!isNew && (
          <div className="space-y-1.5">
            <Label>Monitor-URL</Label>
            <div className="flex items-start gap-2 flex-wrap">
              <MonitorQrButton url={monitorUrl} />
              <div className="flex-1 min-w-0 space-y-1">
                <CopyUrl url={monitorUrl} />
                <p className="text-xs text-slate-400">Diese URL ist öffentlich zugänglich — kein Login erforderlich. QR-Code (Icon) zum Scannen anzeigen.</p>
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

const QR_SIZE_DEFAULT = 96;
const QR_SIZE_DIALOG = 220;

function MonitorUrlQr({ url, size = QR_SIZE_DEFAULT }: { url: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!url || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: size,
      margin: 1,
      color: { dark: "#1e293b", light: "#ffffff" },
    });
  }, [url, size]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <canvas ref={canvasRef} width={size} height={size} className="rounded border border-slate-200 dark:border-slate-700 bg-white" aria-hidden />
      <span className="text-xs text-slate-500">Link zum Scannen</span>
    </div>
  );
}

function QrCodeDialog({ url, open, onOpenChange }: { url: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[280px] flex flex-col items-center py-6">
        <DialogHeader>
          <DialogTitle className="text-center">Monitor-Link scannen</DialogTitle>
        </DialogHeader>
        <MonitorUrlQr url={url} size={QR_SIZE_DIALOG} />
      </DialogContent>
    </Dialog>
  );
}

function MonitorQrButton({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0 text-slate-500 hover:text-indigo-600"
        onClick={() => setOpen(true)}
        title="QR-Code anzeigen"
      >
        <QrCode className="h-4 w-4" />
      </Button>
      <QrCodeDialog url={url} open={open} onOpenChange={setOpen} />
    </>
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

export function MonitorManager({ monitors, devices, accessAreas, baseUrl }: MonitorManagerProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<MonitorConfigData | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [qrDialogUrl, setQrDialogUrl] = useState<string | null>(null);

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
        const isCheckin = monitor.type === "CHECKIN";
        const isResource = monitor.type === "RESOURCE_MONITOR";
        const isScanner = monitor.type === "SCANNER";
        const urlPath = isCheckin
          ? "checkin"
          : isResource
            ? "resource-monitor"
            : isScanner
              ? "scanner"
              : "monitor";
        const url = `${baseUrl}/${urlPath}/${monitor.token}`;
        const deviceNames = isResource
          ? accessAreas
              .filter((a) => (monitor.deviceIds as number[]).includes(a.id))
              .map((a) => a.name)
          : [
              ...devices
                .filter((d) => (monitor.deviceIds as number[]).includes(d.id))
                .map((d) => d.name),
              // Scan-Monitore koennen zusaetzlich auf Bereiche eingegrenzt sein
              // (z.B. Seilbahn B / Uebungslift ohne eigenes Geraet).
              ...accessAreas
                .filter((a) => (monitor.areaIds as number[] | undefined)?.includes(a.id))
                .map((a) => a.name),
            ];
        const TypeIcon = isCheckin
          ? ClipboardCheck
          : isResource
            ? LayoutGrid
            : isScanner
              ? ScanLine
              : Monitor;
        const typeIconColor = isCheckin
          ? "text-emerald-500"
          : isResource
            ? "text-sky-500"
            : isScanner
              ? "text-amber-500"
              : "text-indigo-500";
        const typeBadgeClass = isCheckin
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : isResource
            ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
            : isScanner
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400";
        const typeLabel = isCheckin
          ? "Check-in"
          : isResource
            ? "Ressourcen"
            : isScanner
              ? "Scanner"
              : "Monitor";

        return (
          <Card key={monitor.id} className="border-slate-200 dark:border-slate-800">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <TypeIcon className={cn("h-4 w-4 shrink-0", typeIconColor)} />
                    <span className="font-medium text-slate-900 dark:text-slate-100">{monitor.name}</span>
                    <Badge className={cn("text-xs", typeBadgeClass)}>
                      {typeLabel}
                    </Badge>
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

                  <div className="flex items-start gap-2 flex-wrap">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-slate-500 hover:text-indigo-600"
                      onClick={() => setQrDialogUrl(url)}
                      title="QR-Code anzeigen"
                    >
                      <QrCode className="h-4 w-4" />
                    </Button>
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
                        accessAreas={accessAreas}
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
          accessAreas={accessAreas}
          baseUrl={baseUrl}
          onClose={() => setAddOpen(false)}
        />
      </Dialog>

      <QrCodeDialog url={qrDialogUrl ?? ""} open={!!qrDialogUrl} onOpenChange={(o) => !o && setQrDialogUrl(null)} />
    </div>
  );
}
