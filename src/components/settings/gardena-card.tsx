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
  ExternalLink, AlertCircle, Droplets, Wifi, WifiOff, Battery, Plus, KeyRound,
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

interface Connection {
  id: number;
  name: string;
  keyMasked: string;
  deviceCount: number;
}

interface GardenaCardProps {
  connections: Connection[];
  existingServiceIds: string[];
}

export function GardenaCard({ connections: initialConnections, existingServiceIds }: GardenaCardProps) {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [imported, setImported] = useState<Set<string>>(new Set(existingServiceIds));

  // Ventile je Verbindung (nach "Geräte laden").
  const [valvesByConn, setValvesByConn] = useState<Record<number, GardenaValve[] | null>>({});
  const [loadingConn, setLoadingConn] = useState<number | null>(null);
  const [errorByConn, setErrorByConn] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState<string | null>(null);

  // Neue-Verbindung-Formular.
  const [showAdd, setShowAdd] = useState(initialConnections.length === 0);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [addPreview, setAddPreview] = useState<number | null>(null);

  const canTest = newKey.trim().length > 0 && newSecret.trim().length > 0;

  async function loadValves(configId: number) {
    setLoadingConn(configId);
    setErrorByConn((e) => ({ ...e, [configId]: "" }));
    try {
      const res = await fetch(`/api/settings/gardena?configId=${configId}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorByConn((e) => ({ ...e, [configId]: data.error ?? "Laden fehlgeschlagen" }));
      } else {
        setValvesByConn((v) => ({ ...v, [configId]: data.valves }));
      }
    } catch {
      setErrorByConn((e) => ({ ...e, [configId]: "Netzwerkfehler" }));
    } finally {
      setLoadingConn(null);
    }
  }

  async function handleImport(valve: GardenaValve, configId: number) {
    setImporting(valve.serviceId);
    try {
      const res = await fetch("/api/settings/gardena", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: valve.serviceId, name: valve.name, configId }),
      });
      if (res.ok) {
        setImported((prev) => new Set([...prev, valve.serviceId]));
        setConnections((cs) => cs.map((c) => c.id === configId ? { ...c, deviceCount: c.deviceCount + 1 } : c));
        router.refresh();
      }
    } finally {
      setImporting(null);
    }
  }

  async function handleTestNew() {
    setTesting(true);
    setAddError("");
    setAddPreview(null);
    try {
      const res = await fetch("/api/settings/gardena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationKey: newKey, applicationSecret: newSecret }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAddError(data.error ?? `Verbindung fehlgeschlagen (HTTP ${res.status})`);
      } else {
        setAddPreview((data.valves as GardenaValve[]).length);
      }
    } catch {
      setAddError("Netzwerkfehler");
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveNew() {
    setSaving(true);
    setAddError("");
    try {
      const res = await fetch("/api/settings/gardena", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, applicationKey: newKey, applicationSecret: newSecret }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Fehler beim Speichern");
      } else {
        setConnections((cs) => [...cs, { id: data.id, name: data.name, keyMasked: data.keyMasked, deviceCount: 0 }]);
        setNewName(""); setNewKey(""); setNewSecret(""); setAddPreview(null); setShowAdd(false);
        router.refresh();
      }
    } catch {
      setAddError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(configId: number, name: string) {
    if (!confirm(`Verbindung „${name}" wirklich trennen? Zugeordnete Geräte bleiben erhalten, sind aber ohne Verbindung nicht mehr steuerbar.`)) return;
    await fetch(`/api/settings/gardena?configId=${configId}`, { method: "DELETE" });
    setConnections((cs) => cs.filter((c) => c.id !== configId));
    setValvesByConn((v) => { const n = { ...v }; delete n[configId]; return n; });
    router.refresh();
  }

  const connected = connections.length > 0;

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
              <p className="text-xs text-slate-500">Mehrere Konten möglich · Ventile &amp; Pumpen steuern</p>
            </div>
          </div>
          {connected ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> {connections.length} verbunden
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5">
              <WifiOff className="h-3 w-3" /> Nicht verbunden
            </Badge>
          )}
        </div>

        {/* Verbindungen */}
        {connections.map((conn) => {
          const valves = valvesByConn[conn.id];
          const err = errorByConn[conn.id];
          return (
            <div key={conn.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{conn.name}</p>
                    <p className="text-xs text-slate-400 font-mono truncate">
                      Key {conn.keyMasked} · {conn.deviceCount} Gerät{conn.deviceCount !== 1 ? "e" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    onClick={() => loadValves(conn.id)}
                    disabled={loadingConn === conn.id}
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs"
                  >
                    {loadingConn === conn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Geräte laden
                  </Button>
                  <Button
                    onClick={() => handleDisconnect(conn.id, conn.name)}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {err && (
                <div className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  {err}
                </div>
              )}

              {valves && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      {valves.length} Ventil{valves.length !== 1 ? "e" : ""} / Pumpe · {valves.filter((v) => v.online).length} online
                    </p>
                    {valves.some((v) => !imported.has(v.serviceId)) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={importing !== null}
                        onClick={async () => {
                          for (const v of valves.filter((v) => !imported.has(v.serviceId))) {
                            await handleImport(v, conn.id);
                          }
                        }}
                      >
                        <Download className="h-3 w-3" /> Alle importieren
                      </Button>
                    )}
                  </div>
                  {valves.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-3">Keine Geräte gefunden</p>
                  )}
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {valves.map((valve) => {
                      const alreadyImported = imported.has(valve.serviceId);
                      return (
                        <div
                          key={valve.serviceId}
                          className={cn(
                            "flex items-center justify-between rounded-lg border px-3 py-2 transition-colors",
                            alreadyImported
                              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
                              : "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50",
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                              <Droplets className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{valve.name}</p>
                              <p className="text-xs text-slate-400 truncate">
                                {valve.modelType ?? "GARDENA"}
                                {valve.batteryLevel != null && valve.batteryState !== "NO_BATTERY" && (
                                  <span className="inline-flex items-center gap-0.5 ml-1">· <Battery className="h-3 w-3" /> {valve.batteryLevel}%</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {valve.online ? <Wifi className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4 text-slate-400" />}
                            {alreadyImported ? (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Importiert
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleImport(valve, conn.id)}
                                disabled={importing === valve.serviceId}
                                className="h-7 text-xs gap-1.5"
                              >
                                {importing === valve.serviceId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                Importieren
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <Separator className="dark:bg-slate-800" />

        {/* Neue Verbindung */}
        {!showAdd ? (
          <Button onClick={() => setShowAdd(true)} variant="outline" className="w-full gap-2">
            <Plus className="h-4 w-4" /> GARDENA-Verbindung hinzufügen
          </Button>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Neue GARDENA-Verbindung</p>
              <a
                href="https://developer.husqvarnagroup.cloud/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
              >
                Developer Portal <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="g-name">Name</Label>
              <Input id="g-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="z. B. Hauptkonto / Standort 2" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-key">Application Key</Label>
              <Input id="g-key" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-secret">Application Secret</Label>
              <Input id="g-secret" type="password" value={newSecret} onChange={(e) => setNewSecret(e.target.value)} placeholder="••••••••••••••••••••" className="font-mono" />
              <p className="text-xs text-slate-400">
                Portal → Anwendung → <strong>Authentication API</strong> und <strong>GARDENA smart system API</strong> verbinden, dann Key/Secret kopieren.
              </p>
            </div>

            {addError && (
              <div className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {addError}
              </div>
            )}
            {addPreview !== null && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-lg">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Verbindung ok – {addPreview} Gerät{addPreview !== 1 ? "e" : ""} gefunden.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleTestNew} disabled={testing || !canTest} variant="outline" className="gap-2">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Testen
              </Button>
              <Button onClick={handleSaveNew} disabled={saving || !canTest} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Speichern
              </Button>
              {connections.length > 0 && (
                <Button onClick={() => { setShowAdd(false); setAddError(""); setAddPreview(null); }} variant="ghost" size="sm" className="ml-auto text-slate-400">
                  Abbrechen
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Hinweis */}
        {!connected && (
          <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Im <strong>Husqvarna Developer Portal</strong> eine Anwendung anlegen, die APIs <strong>Authentication</strong> und <strong>GARDENA smart system</strong> verbinden, dann Application Key &amp; Secret hier eintragen.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
