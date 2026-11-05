"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { StatusDot } from "@/components/ui/status-dot";
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
  Wifi, WifiOff, Loader2, CheckCircle2,
  Download, Trash2, RefreshCw, ExternalLink, AlertCircle,
} from "lucide-react";

interface ShellyCloudDevice {
  id: string;
  type: string;
  name: string;
  online: boolean;
  ip?: string;
}

interface ShellyCloudCardProps {
  savedServer: string | null;
  savedAuthKey: string | null;
  existingDeviceIds: string[];
}

const SHELLY_SERVERS = [
  { label: "EU-46", value: "shelly-46-eu.shelly.cloud" },
  { label: "EU-17", value: "shelly-17-eu.shelly.cloud" },
  { label: "EU-78", value: "shelly-78-eu.shelly.cloud" },
  { label: "US", value: "shelly-us.shelly.cloud" },
  { label: "Benutzerdefiniert", value: "custom" },
];

export function ShellyCloudCard({ savedServer, savedAuthKey, existingDeviceIds }: ShellyCloudCardProps) {
  const router = useRouter();
  const [server, setServer] = useState(savedServer ?? "shelly-46-eu.shelly.cloud");
  const [customServer, setCustomServer] = useState("");
  const [authKey, setAuthKey] = useState(savedAuthKey ?? "");
  const [serverPreset, setServerPreset] = useState(
    savedServer && !SHELLY_SERVERS.slice(0, -1).find((s) => s.value === savedServer)
      ? "custom"
      : savedServer ?? "shelly-46-eu.shelly.cloud"
  );

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [devices, setDevices] = useState<ShellyCloudDevice[] | null>(null);
  const [connected, setConnected] = useState(!!savedServer && !!savedAuthKey && !!savedAuthKey.trim());
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set(existingDeviceIds));
  // Rückfrage vor dem Trennen (docs/design-regeln.md, Abschnitt 18).
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Refresh list using saved credentials (no key needed)
  async function handleRefresh() {
    setTesting(true);
    setError("");
    setSyncResult(null);
    try {
      const res = await fetch("/api/settings/shelly-cloud");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Aktualisierung fehlgeschlagen");
      } else {
        setDevices(data.devices);
        setConnected(true);
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setTesting(false);
    }
  }

  const effectiveServer = serverPreset === "custom" ? customServer : serverPreset;

  function handlePresetChange(preset: string) {
    setServerPreset(preset);
    if (preset !== "custom") setServer(preset);
  }

  async function handleTest() {
    setTesting(true);
    setError("");
    setDevices(null);
    setConnected(false);

    try {
      const res = await fetch("/api/settings/shelly-cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: effectiveServer, authKey }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error ?? `Verbindung fehlgeschlagen (HTTP ${res.status})`);
      } else {
        setDevices(data.devices);
        setConnected(true);
        setServer(effectiveServer);
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/shelly-cloud", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: effectiveServer, authKey }),
      });
      if (!res.ok) setError("Fehler beim Speichern");
      else router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(device: ShellyCloudDevice) {
    setImporting(device.id);
    try {
      const res = await fetch("/api/settings/shelly-cloud", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shellyId: device.id, name: device.name, ip: device.ip }),
      });
      if (res.ok) {
        setImported((prev) => new Set([...prev, device.id]));
        router.refresh();
      }
    } finally {
      setImporting(null);
    }
  }

  async function handleSyncNames() {
    setSyncing(true);
    setSyncResult(null);
    setError("");
    try {
      const res = await fetch("/api/settings/shelly-cloud", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Synchronisation fehlgeschlagen");
      } else {
        setSyncResult(
          data.updated === 0
            ? "Alle Namen sind bereits aktuell"
            : `${data.updated} Gerät${data.updated !== 1 ? "e" : ""} aktualisiert`
        );
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    await fetch("/api/settings/shelly-cloud", { method: "DELETE" });
    setConnected(false);
    setDevices(null);
    setAuthKey("");
    router.refresh();
  }

  return (
    <Card>
      {/* Kopf: Symbol-Chip, Titel, Verbindungszustand als Pille (docs/design-regeln.md, Abschnitt 14). */}
      <CardHeader>
        <div className="flex items-center gap-3 min-w-0">
          <IconChip icon={Wifi} tone="primary" size="lg" />
          <div className="min-w-0">
            <CardTitle>Shelly Cloud</CardTitle>
            <CardDescription>Geräte aus der Shelly Cloud verwalten</CardDescription>
          </div>
        </div>
        <CardAction>
          {connected ? (
            <Badge variant="success" className="gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> Verbunden
            </Badge>
          ) : (
            <Badge variant="neutral" className="gap-1.5">
              <WifiOff className="h-3 w-3" /> Nicht verbunden
            </Badge>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Server selection */}
        <div className="space-y-2">
          <Label>Cloud Server</Label>
          {/* Einfachauswahl als Segmentwahl statt eigener Knopfreihe (Abschnitt 14). Fünf Server passen auf
              dem Handy nicht in eine Kapsel: dort eine Auswahlliste mit denselben Einträgen. */}
          <Select value={serverPreset} onValueChange={handlePresetChange}>
            <SelectTrigger aria-label="Cloud Server" className="w-full sm:hidden max-sm:data-[size=default]:h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHELLY_SERVERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Segmented
            value={serverPreset}
            onValueChange={handlePresetChange}
            options={SHELLY_SERVERS.map((s) => ({ value: s.value, label: s.label }))}
            aria-label="Cloud Server"
            className="max-sm:hidden"
          />
          {serverPreset === "custom" && (
            <Input
              value={customServer}
              onChange={(e) => setCustomServer(e.target.value)}
              placeholder="your-server.shelly.cloud"
              className="font-mono"
            />
          )}
        </div>

        {/* Auth Key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="shelly-auth">Auth Key</Label>
            <a
              href="https://control.shelly.cloud/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              Shelly Cloud öffnen <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Input
            id="shelly-auth"
            type="password"
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            placeholder="••••••••••••••••••••"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Shelly Cloud → User Settings → Security → Auth Cloud Key
          </p>
        </div>

        {error && <Notice tone="danger" compact title={error} />}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <Button
              onClick={handleRefresh}
              disabled={testing}
              variant="outline"
              className="gap-2 max-sm:h-11"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Aktualisieren
            </Button>
          ) : (
            <Button
              onClick={handleTest}
              disabled={testing || !authKey || !effectiveServer}
              variant="outline"
              className="gap-2 max-sm:h-11"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Verbindung testen
            </Button>
          )}

          {connected && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-2 max-sm:h-11"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Speichern
            </Button>
          )}

          {savedServer && (
            <Button
              onClick={handleSyncNames}
              disabled={syncing}
              variant="outline"
              size="sm"
              className="gap-1.5 max-sm:h-11"
              title="Namen und IP-Adressen importierter Geräte aus der Shelly Cloud aktualisieren"
            >
              {syncing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Namen aktualisieren
            </Button>
          )}

          {savedServer && (
            <Button
              onClick={() => setConfirmDisconnect(true)}
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5 max-sm:h-11"
            >
              <Trash2 className="h-4 w-4" />
              Trennen
            </Button>
          )}
        </div>

        {syncResult && <Notice tone="success" compact title={syncResult} />}

        {/* Device list */}
        {devices !== null && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground tabular-nums">
                  {devices.length} Gerät{devices.length !== 1 ? "e" : ""} gefunden
                </p>
                <Badge variant="secondary" className="tabular-nums">
                  {devices.filter((d) => d.online).length} online
                </Badge>
              </div>

              {devices.length === 0 && (
                <EmptyState compact icon={Wifi} title="Keine Shelly-Geräte in diesem Account" />
              )}

              <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
                {devices.map((device) => {
                  const alreadyImported = imported.has(device.id);
                  return (
                    // Zeilen ruhig auf Glas – Grün heißt „live“, nicht „erledigt“; importierte Geräte erkennt man
                    // an „Synchronisieren“ statt „Importieren“. Ein Zustandspunkt: grün online, rot offline (Abschnitt 3).
                    <div
                      key={device.id}
                      className="glass-tile flex items-center justify-between px-3 py-2.5 sm:px-4 sm:py-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <StatusDot tone={device.online ? "success" : "danger"} label={device.online ? "online" : "offline"} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{device.name}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {device.id} {device.ip && `· ${device.ip}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <Badge
                          variant="mono"
                          className="hidden sm:flex"
                        >
                          {device.type}
                        </Badge>

                        {alreadyImported ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleImport(device)}
                            disabled={importing === device.id}
                            className="gap-1.5 text-muted-foreground hover:text-foreground max-sm:h-11"
                            title="Name und IP aus Shelly Cloud aktualisieren"
                          >
                            {importing === device.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <RefreshCw className="h-3 w-3" />}
                            Synchronisieren
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleImport(device)}
                            disabled={importing === device.id}
                            className="gap-1.5 max-sm:h-11"
                          >
                            {importing === device.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Download className="h-3 w-3" />}
                            Importieren
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {devices.some((d) => !imported.has(d.id)) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 max-sm:h-11"
                  onClick={async () => {
                    for (const d of devices.filter((d) => !imported.has(d.id))) {
                      await handleImport(d);
                    }
                  }}
                  disabled={importing !== null}
                >
                  <Download className="h-3.5 w-3.5" />
                  Alle nicht importierten Geräte importieren
                </Button>
              )}
            </div>
          </>
        )}

        {/* Hint if not yet tested */}
        {!connected && !devices && !error && (
          <Notice tone="neutral" compact icon={AlertCircle}>
            <span>
              Den Auth Key findest du in der <strong>Shelly Cloud</strong> unter <strong>User Settings → Security → Auth Cloud Key</strong>. Dann auf <strong>Verbindung testen</strong> klicken.
            </span>
          </Notice>
        )}
        {error && error.includes("401") && (
          <Notice tone="warning" compact icon={AlertCircle}>
            <span>
              Auth Key prüfen: <strong>Shelly Cloud</strong> → oben rechts Profilbild → <strong>User Settings</strong> → Tab <strong>Security</strong> → <strong>Auth Cloud Key</strong> kopieren.
            </span>
          </Notice>
        )}
      </CardContent>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Shelly Cloud Verbindung wirklich trennen?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDisconnect()}>
              <Trash2 className="h-4 w-4" />
              Trennen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
