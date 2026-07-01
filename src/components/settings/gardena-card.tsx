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
  Sprout, Loader2, CheckCircle2, Download, Trash2, RefreshCw,
  ExternalLink, AlertCircle, Droplets, Wifi, WifiOff, Battery,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface GardenaValve {
  serviceId: string;
  name: string;
  modelType: string | null;
  activity: string | null;
  online: boolean;
  batteryLevel: number | null;
  batteryState: string | null;
  locationName: string;
}

interface GardenaCardProps {
  savedKey: string | null;
  connected: boolean;
  existingServiceIds: string[];
}

export function GardenaCard({ savedKey, connected: initialConnected, existingServiceIds }: GardenaCardProps) {
  const router = useRouter();
  const [applicationKey, setApplicationKey] = useState(savedKey ?? "");
  const [applicationSecret, setApplicationSecret] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [valves, setValves] = useState<GardenaValve[] | null>(null);
  const [connected, setConnected] = useState(initialConnected);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set(existingServiceIds));

  const canTest = applicationKey.trim().length > 0 && applicationSecret.trim().length > 0;

  async function handleTest() {
    setTesting(true);
    setError("");
    setValves(null);
    try {
      const res = await fetch("/api/settings/gardena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationKey, applicationSecret }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Verbindung fehlgeschlagen (HTTP ${res.status})`);
      } else {
        setValves(data.valves);
        setConnected(true);
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setTesting(false);
    }
  }

  // Aktualisieren mit gespeicherten Zugangsdaten (kein Secret noetig).
  async function handleRefresh() {
    setTesting(true);
    setError("");
    try {
      const res = await fetch("/api/settings/gardena");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Aktualisierung fehlgeschlagen");
      } else {
        setValves(data.valves);
        setConnected(true);
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
      const res = await fetch("/api/settings/gardena", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationKey, applicationSecret }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Fehler beim Speichern");
      } else {
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(valve: GardenaValve) {
    setImporting(valve.serviceId);
    try {
      const res = await fetch("/api/settings/gardena", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: valve.serviceId, name: valve.name }),
      });
      if (res.ok) {
        setImported((prev) => new Set([...prev, valve.serviceId]));
        router.refresh();
      }
    } finally {
      setImporting(null);
    }
  }

  async function handleDisconnect() {
    if (!confirm("GARDENA Verbindung wirklich trennen?")) return;
    await fetch("/api/settings/gardena", { method: "DELETE" });
    setConnected(false);
    setValves(null);
    setApplicationSecret("");
    router.refresh();
  }

  return (
    <Card className={cn(
      "border-2 transition-colors",
      connected ? "border-emerald-300 dark:border-emerald-800" : "border-slate-200 dark:border-slate-800",
    )}>
      <CardContent className="pt-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Sprout className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">GARDENA smart system</p>
              <p className="text-xs text-slate-500">Ventile &amp; Pumpen als Geräte steuern</p>
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

        {/* Zugangsdaten */}
        <div className="space-y-1.5">
          <Label htmlFor="gardena-key">Application Key</Label>
          <Input
            id="gardena-key"
            value={applicationKey}
            onChange={(e) => setApplicationKey(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="gardena-secret">Application Secret</Label>
            <a
              href="https://developer.husqvarnagroup.cloud/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
            >
              Developer Portal <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Input
            id="gardena-secret"
            type="password"
            value={applicationSecret}
            onChange={(e) => setApplicationSecret(e.target.value)}
            placeholder={connected ? "•••••••• (gespeichert)" : "••••••••••••••••••••"}
            className="font-mono"
          />
          <p className="text-xs text-slate-400">
            Portal → deine Anwendung → <strong>Authentication API</strong> und <strong>GARDENA smart system API</strong> verbinden, dann Key/Secret kopieren.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Aktionen */}
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <Button onClick={handleRefresh} disabled={testing} variant="outline" className="gap-2">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Geräte laden
            </Button>
          ) : (
            <Button onClick={handleTest} disabled={testing || !canTest} variant="outline" className="gap-2">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Verbindung testen
            </Button>
          )}

          <Button
            onClick={handleSave}
            disabled={saving || !canTest}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Speichern
          </Button>

          {connected && (
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

        {/* Geräte-Liste */}
        {valves !== null && (
          <>
            <Separator className="dark:bg-slate-800" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {valves.length} Ventil{valves.length !== 1 ? "e" : ""} / Pumpe gefunden
                </p>
                <Badge variant="secondary" className="text-xs">
                  {valves.filter((v) => v.online).length} online
                </Badge>
              </div>

              {valves.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">Keine GARDENA-Geräte gefunden</p>
              )}

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {valves.map((valve) => {
                  const alreadyImported = imported.has(valve.serviceId);
                  return (
                    <div
                      key={valve.serviceId}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-4 py-3 transition-colors",
                        alreadyImported
                          ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
                          : "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50",
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <Droplets className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{valve.name}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {valve.modelType ?? "GARDENA"}
                            {valve.batteryLevel != null && valve.batteryState !== "NO_BATTERY" && (
                              <span className="inline-flex items-center gap-0.5 ml-1">
                                · <Battery className="h-3 w-3" /> {valve.batteryLevel}%
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {valve.online
                          ? <Wifi className="h-4 w-4 text-emerald-500" />
                          : <WifiOff className="h-4 w-4 text-slate-400" />}

                        {alreadyImported ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Importiert
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleImport(valve)}
                            disabled={importing === valve.serviceId}
                            className="h-7 text-xs gap-1.5"
                          >
                            {importing === valve.serviceId
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

              {valves.some((v) => !imported.has(v.serviceId)) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs"
                  onClick={async () => {
                    for (const v of valves.filter((v) => !imported.has(v.serviceId))) {
                      await handleImport(v);
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

        {/* Hinweis */}
        {!connected && !valves && !error && (
          <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Im <strong>Husqvarna Developer Portal</strong> eine Anwendung anlegen, die APIs <strong>Authentication</strong> und <strong>GARDENA smart system</strong> verbinden, dann Application Key &amp; Secret hier eintragen und auf <strong>Verbindung testen</strong> klicken.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
