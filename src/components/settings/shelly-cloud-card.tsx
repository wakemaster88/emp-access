"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Wifi, WifiOff, Loader2, CheckCircle2, XCircle,
  Download, Trash2, RefreshCw, ExternalLink, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    if (!confirm("Shelly Cloud Verbindung wirklich trennen?")) return;
    await fetch("/api/settings/shelly-cloud", { method: "DELETE" });
    setConnected(false);
    setDevices(null);
    setAuthKey("");
    router.refresh();
  }

  return (
    <Card className={cn(
      "border-2 transition-colors",
      connected
        ? "border-amber-300 dark:border-amber-700"
        : "border-slate-200 dark:border-slate-800"
    )}>
      <CardContent className="pt-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Wifi className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">Shelly Cloud</p>
              <p className="text-xs text-slate-500">Geräte aus der Shelly Cloud verwalten</p>
            </div>
          </div>
          {connected ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> Verbunden
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5">
              <WifiOff className="h-3 w-3" /> Nicht verbunden
            </Badge>
          )}
        </div>

        <Separator className="dark:bg-slate-800" />

        {/* Server selection */}
        <div className="space-y-2">
          <Label>Cloud Server</Label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {SHELLY_SERVERS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => handlePresetChange(s.value)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs text-center transition-all",
                  serverPreset === s.value
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 font-medium"
                    : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          {serverPreset === "custom" && (
            <Input
              value={customServer}
              onChange={(e) => setCustomServer(e.target.value)}
              placeholder="your-server.shelly.cloud"
              className="font-mono text-sm"
            />
          )}
        </div>

        {/* Auth Key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="shelly-auth">Auth Key</Label>
            <a
              href="https://control.shelly.cloud/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
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
          <p className="text-xs text-slate-400">
            Shelly Cloud → User Settings → Security → Auth Cloud Key
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <Button
              onClick={handleRefresh}
              disabled={testing}
              variant="outline"
              className="gap-2"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Aktualisieren
            </Button>
          ) : (
            <Button
              onClick={handleTest}
              disabled={testing || !authKey || !effectiveServer}
              variant="outline"
              className="gap-2"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Verbindung testen
            </Button>
          )}

          {connected && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
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
              className="gap-1.5"
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
              onClick={handleDisconnect}
              variant="ghost"
              size="sm"
              className="ml-auto text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              Trennen
            </Button>
          )}
        </div>

        {syncResult && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-lg">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {syncResult}
          </div>
        )}

        {/* Device list */}
        {devices !== null && (
          <>
            <Separator className="dark:bg-slate-800" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {devices.length} Gerät{devices.length !== 1 ? "e" : ""} gefunden
                </p>
                <Badge variant="secondary" className="text-xs">
                  {devices.filter((d) => d.online).length} online
                </Badge>
              </div>

              {devices.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">Keine Shelly-Geräte in diesem Account</p>
              )}

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {devices.map((device) => {
                  const alreadyImported = imported.has(device.id);
                  return (
                    <div
                      key={device.id}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-4 py-3 transition-colors",
                        alreadyImported
                          ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
                          : "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          device.online ? "bg-emerald-400" : "bg-slate-400"
                        )} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{device.name}</p>
                          <p className="text-xs text-slate-400 font-mono truncate">
                            {device.id} {device.ip && `· ${device.ip}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <Badge
                          variant="secondary"
                          className="text-xs hidden sm:flex"
                        >
                          {device.type}
                        </Badge>
                        {device.online
                          ? <Wifi className="h-4 w-4 text-emerald-500" />
                          : <WifiOff className="h-4 w-4 text-slate-400" />}

                        {alreadyImported ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleImport(device)}
                            disabled={importing === device.id}
                            className="h-7 text-xs gap-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
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
                            className="h-7 text-xs gap-1.5"
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
                  className="w-full gap-2 text-xs"
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
          <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Den Auth Key findest du in der <strong>Shelly Cloud</strong> unter <strong>User Settings → Security → Auth Cloud Key</strong>. Dann auf <strong>Verbindung testen</strong> klicken.
            </span>
          </div>
        )}
        {error && error.includes("401") && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-lg px-3 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Auth Key prüfen: <strong>Shelly Cloud</strong> → oben rechts Profilbild → <strong>User Settings</strong> → Tab <strong>Security</strong> → <strong>Auth Cloud Key</strong> kopieren.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
