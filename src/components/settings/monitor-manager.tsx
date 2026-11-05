"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Copy, Check, ExternalLink, Monitor,
  Loader2, Pencil, Wifi, WifiOff, QrCode, ClipboardCheck, LayoutGrid, ScanLine, Power,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeviceCategory } from "@prisma/client";
import { deviceControls } from "@/lib/device-controls";

interface Device {
  id: number;
  name: string;
  type: string;
  category: DeviceCategory | null;
  isActive: boolean;
}

interface MonitorConfigData {
  id: number;
  name: string;
  token: string;
  type: string;
  deviceIds: number[];
  areaIds: number[];
  controlDeviceIds: number[];
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

// Typ-Kachel im Dialog: Glas, gewählt in Akzentfarbe statt einer eigenen Farbe je Typ
// (docs/design-regeln.md, Abschnitte 3 und 17).
function typeTileClass(active: boolean) {
  return cn(
    "glass-tile press flex items-center gap-2.5 p-3 text-left",
    active ? "border-primary/60 bg-primary/10" : "hover:bg-glass-strong",
  );
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
  const [selectedControlDevices, setSelectedControlDevices] = useState<number[]>(monitor?.controlDeviceIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // QR-Code klappt im selben Dialog auf, statt einen zweiten Dialog zu öffnen (docs/design-regeln.md, Abschnitt 18).
  const [showQr, setShowQr] = useState(false);

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

  function toggleControlDevice(id: number) {
    setSelectedControlDevices((prev) =>
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
        body: JSON.stringify({
          name: name.trim(),
          type,
          deviceIds: selectedDevices,
          areaIds: type === "MONITOR" ? selectedAreas : [],
          controlDeviceIds: type === "MONITOR" ? selectedControlDevices : [],
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
          <Label htmlFor="m-name">Name <span className="text-destructive">*</span></Label>
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
              aria-pressed={type === "MONITOR"}
              className={typeTileClass(type === "MONITOR")}
            >
              <Monitor className={cn("h-4 w-4 shrink-0", type === "MONITOR" ? "text-primary" : "text-muted-foreground")} />
              <div>
                <p className="text-sm font-medium text-foreground">Scan-Monitor</p>
                <p className="text-xs text-muted-foreground">Live-Scans</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setType("CHECKIN")}
              aria-pressed={type === "CHECKIN"}
              className={typeTileClass(type === "CHECKIN")}
            >
              <ClipboardCheck className={cn("h-4 w-4 shrink-0", type === "CHECKIN" ? "text-primary" : "text-muted-foreground")} />
              <div>
                <p className="text-sm font-medium text-foreground">Check-in</p>
                <p className="text-xs text-muted-foreground">Gäste einchecken</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setType("RESOURCE_MONITOR")}
              aria-pressed={type === "RESOURCE_MONITOR"}
              className={typeTileClass(type === "RESOURCE_MONITOR")}
            >
              <LayoutGrid className={cn("h-4 w-4 shrink-0", type === "RESOURCE_MONITOR" ? "text-primary" : "text-muted-foreground")} />
              <div>
                <p className="text-sm font-medium text-foreground">Ressourcen</p>
                <p className="text-xs text-muted-foreground">Tagesübersicht</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setType("SCANNER")}
              aria-pressed={type === "SCANNER"}
              className={typeTileClass(type === "SCANNER")}
            >
              <ScanLine className={cn("h-4 w-4 shrink-0", type === "SCANNER" ? "text-primary" : "text-muted-foreground")} />
              <div>
                <p className="text-sm font-medium text-foreground">Scanner</p>
                <p className="text-xs text-muted-foreground">QR-Kamera, Token</p>
              </div>
            </button>
          </div>
        </div>

        {type === "CHECKIN" && <div className="space-y-2">
          <Label>Tür-Schnellzugriff</Label>
          <p className="text-xs text-muted-foreground">
            Ausgewählte Türen erscheinen als direkter Button im Header des Check-in Monitors. Alle übrigen Türen / Drehkreuze sind weiterhin über das &bdquo;Mehr Türen&ldquo;-Menü erreichbar.
          </p>
          <Checklist aria-label="Tür-Schnellzugriff" maxHeight="12rem">
            {devices.filter((d) => d.category === "TUER" || d.category === "DREHKREUZ").length === 0 && (
              <EmptyState
                size="sm"
                title="Keine Türen / Drehkreuze vorhanden."
                description="Setze die Kategorie eines Gerätes auf Tür oder Drehkreuz."
              />
            )}
            {devices
              .filter((d) => d.category === "TUER" || d.category === "DREHKREUZ")
              .map((device) => (
                <ChecklistItem
                  key={device.id}
                  checked={selectedDevices.includes(device.id)}
                  onCheckedChange={() => toggleDevice(device.id)}
                  title={device.name}
                  description={device.category === "DREHKREUZ" ? "Drehkreuz" : "Tür"}
                  trailing={device.isActive
                    ? <Wifi className="h-4 w-4 text-success shrink-0" />
                    : <WifiOff className="h-4 w-4 text-muted-foreground shrink-0" />}
                />
              ))}
          </Checklist>
          {selectedDevices.length > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">{selectedDevices.length} Tür(en) als Schnellzugriff</p>
          )}
        </div>}

        {(type === "MONITOR" || type === "SCANNER") && <div className="space-y-2">
          <Label>Geräte auswählen</Label>
          {type === "SCANNER" && (
            <p className="text-xs text-muted-foreground">
              Optional: Das erste ausgewählte Gerät wird als Scan-Quelle in der Historie hinterlegt.
            </p>
          )}
          <Checklist aria-label="Geräte auswählen" maxHeight="12rem">
            {devices.length === 0 && (
              <EmptyState size="sm" title="Keine Geräte vorhanden" />
            )}
            {devices.map((device) => (
              <ChecklistItem
                key={device.id}
                checked={selectedDevices.includes(device.id)}
                onCheckedChange={() => toggleDevice(device.id)}
                title={device.name}
                description={device.type === "RASPBERRY_PI" ? "Raspberry Pi" : "Shelly"}
                trailing={device.isActive
                  ? <Wifi className="h-4 w-4 text-success shrink-0" />
                  : <WifiOff className="h-4 w-4 text-muted-foreground shrink-0" />}
              />
            ))}
          </Checklist>
          {selectedDevices.length > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">{selectedDevices.length} Gerät(e) ausgewählt</p>
          )}
        </div>}

        {type === "MONITOR" && <div className="space-y-2">
          <Label>Geräte steuern</Label>
          <p className="text-xs text-muted-foreground">
            Ausgewählte Geräte erscheinen als Schalter auf dem Scan-Monitor – z.&nbsp;B. ein Shelly, der das Drehkreuz aus- und einschaltet.
          </p>
          <Checklist aria-label="Geräte steuern" maxHeight="12rem">
            {devices.filter((d) => deviceControls(d).length > 0).length === 0 && (
              <EmptyState size="sm" title="Keine schaltbaren Geräte vorhanden." />
            )}
            {devices
              .filter((d) => deviceControls(d).length > 0)
              .map((device) => {
                const selected = selectedControlDevices.includes(device.id);
                const actions = deviceControls(device).map((c) => c.label).join(" · ");
                return (
                  <ChecklistItem
                    key={device.id}
                    checked={selected}
                    onCheckedChange={() => toggleControlDevice(device.id)}
                    // ChecklistItem hat keinen Platz für ein Symbol vorn: das Power-Symbol steht im Titel vor dem Namen.
                    title={
                      <span className="inline-flex items-center gap-1.5">
                        <Power className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
                        {device.name}
                      </span>
                    }
                    description={actions}
                    trailing={device.isActive
                      ? <Wifi className="h-4 w-4 text-success shrink-0" />
                      : <WifiOff className="h-4 w-4 text-muted-foreground shrink-0" />}
                  />
                );
              })}
          </Checklist>
          {selectedControlDevices.length > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">{selectedControlDevices.length} Steuergerät(e)</p>
          )}
        </div>}

        {type === "MONITOR" && <div className="space-y-2">
          <Label>Bereiche (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Grenzt die Personen-/Ticketliste auf diese Bereiche ein – nützlich für Bereiche <span className="font-medium">ohne eigenes Scan-Gerät</span> (z.B. Seilbahn B, Übungslift). Ohne Auswahl gelten die Bereiche der ausgewählten Geräte.
          </p>
          <Checklist aria-label="Bereiche (optional)" maxHeight="12rem">
            {accessAreas.length === 0 && (
              <EmptyState size="sm" title="Keine Bereiche vorhanden" />
            )}
            {accessAreas.map((area) => (
              <ChecklistItem
                key={area.id}
                checked={selectedAreas.includes(area.id)}
                onCheckedChange={() => toggleArea(area.id)}
                title={area.name}
              />
            ))}
          </Checklist>
          {selectedAreas.length > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">{selectedAreas.length} Bereich(e) als Filter</p>
          )}
        </div>}

        {type === "RESOURCE_MONITOR" && <div className="space-y-2">
          <Label>Bereiche auswählen</Label>
          <p className="text-xs text-muted-foreground">Wähle die Bereiche, die im Ressourcen-Monitor angezeigt werden. Ohne Auswahl werden alle Dashboard-Bereiche verwendet.</p>
          <Checklist aria-label="Bereiche auswählen" maxHeight="12rem">
            {accessAreas.length === 0 && (
              <EmptyState size="sm" title="Keine Bereiche vorhanden" />
            )}
            {accessAreas.map((area) => (
              <ChecklistItem
                key={area.id}
                checked={selectedDevices.includes(area.id)}
                onCheckedChange={() => toggleDevice(area.id)}
                title={area.name}
              />
            ))}
          </Checklist>
          {selectedDevices.length > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">{selectedDevices.length} Bereich(e) ausgewählt</p>
          )}
        </div>}

        {!isNew && (
          <div className="space-y-1.5">
            <Label>Monitor-URL</Label>
            <div className="flex items-start gap-2 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn("shrink-0 text-muted-foreground hover:text-primary max-sm:size-11", showQr && "text-primary")}
                onClick={() => setShowQr((v) => !v)}
                aria-expanded={showQr}
                title="QR-Code anzeigen"
                aria-label="QR-Code anzeigen"
              >
                <QrCode className="h-4 w-4" />
              </Button>
              <div className="flex-1 min-w-0 space-y-1">
                <CopyUrl url={monitorUrl} />
                <p className="text-xs text-muted-foreground">Diese URL ist öffentlich zugänglich — kein Login erforderlich. QR-Code (Icon) zum Scannen anzeigen.</p>
              </div>
            </div>
            {showQr && (
              <div className="flex justify-center pt-2">
                <MonitorUrlQr url={monitorUrl} size={QR_SIZE_DIALOG} />
              </div>
            )}
          </div>
        )}

        {error && <Notice tone="danger" compact title={error} />}

        <Separator />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" disabled={saving || !name.trim()} className="min-w-28">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isNew ? "Erstellen" : "Speichern"}
          </Button>
        </DialogFooter>
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
    const canvas = canvasRef.current;
    void import("qrcode").then((m) =>
      m.default.toCanvas(canvas, url, {
        width: size,
        margin: 1,
        color: { dark: "#1e293b", light: "#ffffff" },
      }),
    );
  }, [url, size]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* QR-Code bleibt auf Weiß: Ruhezone und Kontrast zum Scannen, auch im Dunkeln. Weißer Rand (p-2) wie bei den
          anderen QR-Codes (Mitarbeiter-Link, Zwei-Faktor), sonst grenzt der Code im Dunkeln fast direkt an die Fläche. */}
      <div className="rounded-xl border border-border bg-white p-2">
        <canvas ref={canvasRef} width={size} height={size} className="block" aria-hidden />
      </div>
      <span className="text-xs text-muted-foreground">Link zum Scannen</span>
    </div>
  );
}

function QrCodeDialog({ url, open, onOpenChange }: { url: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[300px] flex flex-col items-center">
        <DialogHeader>
          <DialogTitle className="text-center">Monitor-Link scannen</DialogTitle>
        </DialogHeader>
        <MonitorUrlQr url={url} size={QR_SIZE_DIALOG} />
      </DialogContent>
    </Dialog>
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
      <Input value={url} readOnly className="font-mono max-sm:h-11" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={copy}
        className="shrink-0 max-sm:size-11"
        title="Kopieren"
        aria-label="Kopieren"
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        asChild
        className="shrink-0 max-sm:size-11"
        title="Im neuen Tab öffnen"
        aria-label="Im neuen Tab öffnen"
      >
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
  // Rückfrage vor dem Löschen (docs/design-regeln.md, Abschnitt 18); der Monitor bleibt gesetzt,
  // solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<MonitorConfigData | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function askDelete(monitor: MonitorConfigData) {
    setToDelete(monitor);
    setConfirmOpen(true);
  }

  async function handleDelete(monitor: MonitorConfigData) {
    setDeleting(monitor.id);
    try {
      await fetch(`/api/monitors/${monitor.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Kopf der Liste (docs/design-regeln.md, Abschnitt 13): „Monitor erstellen“ oben rechts statt als
          Taste unter der Liste. Handy: Anzahl links und Taste rechts in der ersten Zeile, die Erklärung
          darunter in voller Breite; ab sm die Erklärung links, Anzahl und Taste rechts daneben. */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[1fr_auto_auto]">
        <p className="col-span-2 row-start-2 text-sm text-muted-foreground sm:col-span-1 sm:row-start-1">
          Erstelle und verwalte öffentliche Monitore für Scan-Ansichten, Check-ins, Ressourcen-Übersichten und Token-Scanner.
        </p>
        <Badge variant="secondary" className="tabular-nums">
          {monitors.length} Monitor{monitors.length !== 1 ? "e" : ""}
        </Badge>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="max-sm:h-11">
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
      </div>

      {monitors.length === 0 && (
        <Card>
          <EmptyState
            compact
            icon={Monitor}
            title="Noch kein Monitor erstellt."
            description="Erstelle einen öffentlichen Monitor für ausgewählte Geräte."
          />
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
        const controlNames = devices
          .filter((d) => (monitor.controlDeviceIds ?? []).includes(d.id))
          .map((d) => d.name);
        const TypeIcon = isCheckin
          ? ClipboardCheck
          : isResource
            ? LayoutGrid
            : isScanner
              ? ScanLine
              : Monitor;
        const typeLabel = isCheckin
          ? "Check-in"
          : isResource
            ? "Ressourcen"
            : isScanner
              ? "Scanner"
              : "Monitor";

        return (
          <Card key={monitor.id}>
            {/* Typ als Symbol und Text, keine eigene Farbe je Typ; Zustand Aktiv/Inaktiv als Pille. */}
            <CardHeader>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <IconChip icon={TypeIcon} tone="primary" size="sm" />
                <CardTitle className="min-w-0 break-words">{monitor.name}</CardTitle>
                <Badge variant="secondary">
                  {typeLabel}
                </Badge>
                <Badge variant={monitor.isActive ? "success" : "neutral"}>
                  {monitor.isActive ? "Aktiv" : "Inaktiv"}
                </Badge>
              </div>

              <CardAction className="flex gap-1">
                <Dialog open={editing?.id === monitor.id} onOpenChange={(o) => { if (!o) setEditing(null); }}>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground max-sm:size-11"
                      onClick={() => setEditing(monitor)}
                      title="Bearbeiten"
                      aria-label="Bearbeiten"
                    >
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
                  variant="ghost" size="icon-sm"
                  className="text-muted-foreground hover:text-destructive max-sm:size-11"
                  onClick={() => askDelete(monitor)}
                  disabled={deleting === monitor.id}
                  title="Löschen"
                  aria-label="Löschen"
                >
                  {deleting === monitor.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Trash2 className="h-4 w-4" />}
                </Button>
              </CardAction>
            </CardHeader>

            <CardContent className="space-y-2">
              {deviceNames.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {deviceNames.map((n) => (
                    <Badge key={n} variant="secondary" className="font-normal">{n}</Badge>
                  ))}
                </div>
              )}
              {controlNames.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {controlNames.map((n) => (
                    <Badge key={`ctrl-${n}`} variant="outline" className="font-normal">
                      Steuert {n}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex items-start gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-primary max-sm:size-11"
                  onClick={() => setQrDialogUrl(url)}
                  title="QR-Code anzeigen"
                  aria-label="QR-Code anzeigen"
                >
                  <QrCode className="h-4 w-4" />
                </Button>
                <div className="flex-1 min-w-0 space-y-1">
                  <CopyUrl url={url} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Monitor "${toDelete?.name ?? ""}" wirklich löschen?`}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toDelete) void handleDelete(toDelete);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QrCodeDialog url={qrDialogUrl ?? ""} open={!!qrDialogUrl} onOpenChange={(o) => !o && setQrDialogUrl(null)} />
    </div>
  );
}
