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
import { Separator } from "@/components/ui/separator";
import { StatusDot } from "@/components/ui/status-dot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sprout, Loader2, CheckCircle2, Download, Trash2, RefreshCw,
  ExternalLink, AlertCircle, Droplets, WifiOff, Battery, Plus, KeyRound,
} from "lucide-react";

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

  // Rückfrage vor dem Trennen (docs/design-regeln.md, Abschnitt 18); die Verbindung bleibt gesetzt,
  // solange der Dialog ausblendet.
  const [toDisconnect, setToDisconnect] = useState<Connection | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  function askDisconnect(conn: Connection) {
    setToDisconnect(conn);
    setConfirmOpen(true);
  }

  async function handleDisconnect(configId: number) {
    await fetch(`/api/settings/gardena?configId=${configId}`, { method: "DELETE" });
    setConnections((cs) => cs.filter((c) => c.id !== configId));
    setValvesByConn((v) => { const n = { ...v }; delete n[configId]; return n; });
    router.refresh();
  }

  const connected = connections.length > 0;

  return (
    <Card>
      {/* Kopf: Symbol-Chip, Titel, Verbindungszustand als Pille (docs/design-regeln.md, Abschnitt 14). */}
      <CardHeader>
        <div className="flex items-center gap-3 min-w-0">
          <IconChip icon={Sprout} tone="primary" size="lg" />
          <div className="min-w-0">
            <CardTitle>GARDENA smart system</CardTitle>
            <CardDescription>Mehrere Konten möglich · Ventile &amp; Pumpen steuern</CardDescription>
          </div>
        </div>
        <CardAction>
          {connected ? (
            <Badge variant="success" className="gap-1.5 tabular-nums">
              <CheckCircle2 className="h-3 w-3" /> {connections.length} verbunden
            </Badge>
          ) : (
            <Badge variant="neutral" className="gap-1.5">
              <WifiOff className="h-3 w-3" /> Nicht verbunden
            </Badge>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Verbindungen */}
        {connections.map((conn) => {
          const valves = valvesByConn[conn.id];
          const err = errorByConn[conn.id];
          return (
            <div key={conn.id} className="glass-tile p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <IconChip icon={KeyRound} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{conn.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
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
                    className="gap-1.5 max-sm:h-11"
                  >
                    {loadingConn === conn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Geräte laden
                  </Button>
                  <Button
                    onClick={() => askDisconnect(conn)}
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 max-sm:size-11"
                    title="Verbindung trennen"
                    aria-label="Verbindung trennen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {err && <Notice tone="danger" compact title={err} />}

              {valves && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground tabular-nums">
                      {valves.length} Ventil{valves.length !== 1 ? "e" : ""} / Pumpe · {valves.filter((v) => v.online).length} online
                    </p>
                    {valves.some((v) => !imported.has(v.serviceId)) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 max-sm:h-11"
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
                    <EmptyState compact icon={Droplets} title="Keine Geräte gefunden" />
                  )}
                  {/* Zeilen ruhig auf Glas; „Importiert“ zeigt die Pille rechts. */}
                  <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-thin pr-1">
                    {valves.map((valve) => {
                      const alreadyImported = imported.has(valve.serviceId);
                      return (
                        <div
                          key={valve.serviceId}
                          className="flex items-center justify-between rounded-control bg-glass-tile px-3 py-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <IconChip icon={Droplets} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{valve.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {valve.modelType ?? "GARDENA"}
                                {valve.batteryLevel != null && valve.batteryState !== "NO_BATTERY" && (
                                  <span className="inline-flex items-center gap-0.5 ml-1 tabular-nums">· <Battery className="h-3 w-3" /> {valve.batteryLevel}%</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {/* Ein Zustandspunkt: grün online, rot offline (docs/design-regeln.md, Abschnitt 3). */}
                            <StatusDot tone={valve.online ? "success" : "danger"} label={valve.online ? "online" : "offline"} />
                            {alreadyImported ? (
                              <Badge variant="success">
                                <CheckCircle2 className="h-3 w-3" /> Importiert
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleImport(valve, conn.id)}
                                disabled={importing === valve.serviceId}
                                className="gap-1.5 max-sm:h-11"
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

        <Separator />

        {/* Neue Verbindung */}
        {!showAdd ? (
          <Button onClick={() => setShowAdd(true)} variant="outline" className="w-full gap-2 max-sm:h-11">
            <Plus className="h-4 w-4" /> GARDENA-Verbindung hinzufügen
          </Button>
        ) : (
          <div className="glass-tile p-3 sm:p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Neue GARDENA-Verbindung</p>
              <a
                href="https://developer.husqvarnagroup.cloud/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
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
              <Input id="g-key" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-secret">Application Secret</Label>
              <Input id="g-secret" type="password" value={newSecret} onChange={(e) => setNewSecret(e.target.value)} placeholder="••••••••••••••••••••" className="font-mono" />
              <p className="text-xs text-muted-foreground">
                Portal → Anwendung → <strong>Authentication API</strong> und <strong>GARDENA smart system API</strong> verbinden, dann Key/Secret kopieren.
              </p>
            </div>

            {addError && <Notice tone="danger" compact title={addError} />}
            {addPreview !== null && (
              <Notice
                tone="success"
                compact
                title={<>Verbindung ok – {addPreview} Gerät{addPreview !== 1 ? "e" : ""} gefunden.</>}
              />
            )}

            {/* Primärtaste rechts, Abbrechen links davon; auf dem Handy volle Breite, Primärtaste oben (Abschnitt 16). */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {connections.length > 0 && (
                <Button onClick={() => { setShowAdd(false); setAddError(""); setAddPreview(null); }} variant="ghost" className="text-muted-foreground max-sm:h-11">
                  Abbrechen
                </Button>
              )}
              <Button onClick={handleTestNew} disabled={testing || !canTest} variant="outline" className="gap-2 max-sm:h-11">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Testen
              </Button>
              <Button onClick={handleSaveNew} disabled={saving || !canTest} className="gap-2 max-sm:h-11">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Speichern
              </Button>
            </div>
          </div>
        )}

        {/* Hinweis */}
        {!connected && (
          <Notice tone="neutral" compact icon={AlertCircle}>
            <span>
              Im <strong>Husqvarna Developer Portal</strong> eine Anwendung anlegen, die APIs <strong>Authentication</strong> und <strong>GARDENA smart system</strong> verbinden, dann Application Key &amp; Secret hier eintragen.
            </span>
          </Notice>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Verbindung „${toDisconnect?.name ?? ""}" wirklich trennen?`}</AlertDialogTitle>
            <AlertDialogDescription>
              Zugeordnete Geräte bleiben erhalten, sind aber ohne Verbindung nicht mehr steuerbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toDisconnect) void handleDisconnect(toDisconnect.id);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Trennen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
