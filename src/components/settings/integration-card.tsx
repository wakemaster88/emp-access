"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Circle, Trash2, Save, ChevronDown, ChevronUp, RefreshCw, MapPin } from "lucide-react";
import { cn, fmtDate } from "@/lib/utils";

export interface ApiConfigData {
  id?: number;
  provider: string;
  token: string;
  eventId?: string | null;
  baseUrl?: string | null;
  extraConfig?: string | null;
  lastUpdate?: Date | string | null;
}

interface ProviderMeta {
  label: string;
  description: string;
  color: string;
  fields: {
    token: string;
    eventId?: string;
    baseUrl?: string;
    extraConfig?: string;
  };
}

const SYNC_ENDPOINTS: Record<string, { method: string; url: string }> = {
  ANNY: { method: "POST", url: "/api/integrations/anny" },
  BINARYTEC: { method: "POST", url: "/api/integrations/binarytec" },
  EMP_CONTROL: { method: "GET", url: "/api/integrations/emp-control" },
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  ANNY: {
    label: "anny.co",
    description: "Buchungsplattform – synchronisiert Buchungen als Tickets",
    color: "bg-violet-500",
    fields: {
      token: "Access Token",
      baseUrl: "Base URL (optional, Standard: https://b.anny.co)",
    },
  },
  WAKESYS: {
    label: "Wakesys",
    description: "Wakepark Management & Ticketsystem",
    color: "bg-cyan-500",
    fields: {
      token: "API Token",
      baseUrl: "Base URL",
    },
  },
  BINARYTEC: {
    label: "Binarytec",
    description: "Zugangskontrolle & Ticket-Synchronisation",
    color: "bg-orange-500",
    fields: {
      token: "API Token",
      baseUrl: "Base URL",
    },
  },
  EMP_CONTROL: {
    label: "emp-control",
    description: "Personalmanagement-System (bidirektional)",
    color: "bg-indigo-500",
    fields: {
      token: "API Token",
      baseUrl: "System-URL",
      extraConfig: "Zusatz-Konfiguration (JSON, optional)",
    },
  },
};

interface AreaOption {
  id: number;
  name: string;
}

interface IntegrationCardProps {
  provider: string;
  initialData: ApiConfigData | null;
  areas?: AreaOption[];
}

export function IntegrationCard({ provider, initialData, areas }: IntegrationCardProps) {
  const meta = PROVIDER_META[provider];
  const [open, setOpen] = useState(!!initialData);
  const [data, setData] = useState<ApiConfigData>(
    initialData ?? { provider, token: "", eventId: "", baseUrl: "", extraConfig: "" }
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const isConfigured = !!initialData?.token;

  // Parse anny service→area mapping from extraConfig
  const parsedExtra = (() => {
    try {
      if (data.extraConfig) return JSON.parse(data.extraConfig) as { mappings?: Record<string, number>; services?: string[]; resources?: string[] };
    } catch { /* ignore */ }
    return { mappings: {}, services: [] as string[], resources: [] as string[] };
  })();
  const annyResources = parsedExtra.resources || [];
  const annyServiceNames = (parsedExtra.services || []).filter((s) => !annyResources.includes(s));
  const annyMappings = parsedExtra.mappings || {};

  function updateMapping(serviceName: string, areaId: number | null) {
    const newMappings = { ...annyMappings };
    if (areaId === null) {
      delete newMappings[serviceName];
    } else {
      newMappings[serviceName] = areaId;
    }
    const updated = { ...parsedExtra, mappings: newMappings };
    setData({ ...data, extraConfig: JSON.stringify(updated) });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error?.formErrors?.[0] ?? "Speichern fehlgeschlagen");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  const syncEndpoint = SYNC_ENDPOINTS[provider];

  async function handleSync() {
    if (!syncEndpoint) return;
    setSyncing(true);
    setError("");
    setSyncResult(null);
    try {
      const res = await fetch(syncEndpoint.url, {
        method: syncEndpoint.method,
        signal: AbortSignal.timeout(120000),
      });
      let json;
      try {
        json = await res.json();
      } catch {
        setError(`Server-Fehler: ${res.status} ${res.statusText}`);
        return;
      }
      if (!res.ok) {
        setError(json.error || `Sync fehlgeschlagen (${res.status})`);
      } else {
        const parts: string[] = [];
        if (json.created) parts.push(`${json.created} neu`);
        if (json.updated) parts.push(`${json.updated} aktualisiert`);
        if (json.invalidated) parts.push(`${json.invalidated} invalidiert`);
        if (json.skipped) parts.push(`${json.skipped} übersprungen`);
        if (json.resources) parts.push(`${json.resources} Ressourcen`);
        if (json.total !== undefined && json.groups !== undefined) {
          parts.push(`${json.total} Buchungen → ${json.groups} Tickets`);
        } else if (json.total !== undefined) {
          parts.push(`${json.total} gesamt`);
        }
        setSyncResult(parts.length ? parts.join(", ") : "Keine neuen Daten");
        setTimeout(() => setSyncResult(null), 8000);

        // Reload config to show newly discovered services/resources
        try {
          const cfgRes = await fetch("/api/settings/integrations");
          if (cfgRes.ok) {
            const configs = await cfgRes.json();
            const updated = Array.isArray(configs)
              ? configs.find((c: ApiConfigData) => c.provider === provider)
              : null;
            if (updated) {
              setData(updated);
            }
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unbekannt";
      if (msg.includes("abort") || msg.includes("timeout")) {
        setError("Sync-Timeout – bitte erneut versuchen");
      } else {
        setError(`Netzwerkfehler: ${msg}`);
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Möchtest du die ${meta.label}-Integration wirklich löschen?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/settings/integrations?provider=${provider}`, { method: "DELETE" });
      setData({ provider, token: "", eventId: "", baseUrl: "", extraConfig: "" });
      setOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className={cn("border-slate-200 dark:border-slate-800 transition-all", open && "ring-1 ring-indigo-500/30")}>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0", meta.color)}>
              {meta.label.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {meta.label}
                {isConfigured ? (
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs font-normal gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Verbunden
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs font-normal gap-1">
                    <Circle className="h-3 w-3" /> Nicht konfiguriert
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">{meta.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            {initialData?.lastUpdate && (
              <span className="text-xs hidden sm:flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                {fmtDate(initialData.lastUpdate)}
              </span>
            )}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>

      {open && (
        <>
          <Separator className="dark:bg-slate-800" />
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${provider}-token`}>{meta.fields.token}</Label>
              <Input
                id={`${provider}-token`}
                type="password"
                placeholder="••••••••••••••••"
                value={data.token}
                onChange={(e) => setData({ ...data, token: e.target.value })}
                className="font-mono"
              />
            </div>

            {meta.fields.eventId !== undefined && (
              <div className="space-y-2">
                <Label htmlFor={`${provider}-eventId`}>{meta.fields.eventId}</Label>
                <Input
                  id={`${provider}-eventId`}
                  placeholder="z.B. evt_12345"
                  value={data.eventId ?? ""}
                  onChange={(e) => setData({ ...data, eventId: e.target.value })}
                />
              </div>
            )}

            {meta.fields.baseUrl !== undefined && (
              <div className="space-y-2">
                <Label htmlFor={`${provider}-baseUrl`}>{meta.fields.baseUrl}</Label>
                <Input
                  id={`${provider}-baseUrl`}
                  placeholder={provider === "ANNY" ? "https://b.anny.co" : "https://api.example.com"}
                  value={data.baseUrl ?? ""}
                  onChange={(e) => setData({ ...data, baseUrl: e.target.value })}
                />
              </div>
            )}

            {meta.fields.extraConfig !== undefined && (
              <div className="space-y-2">
                <Label htmlFor={`${provider}-extra`}>{meta.fields.extraConfig}</Label>
                <Input
                  id={`${provider}-extra`}
                  placeholder={provider === "EMP_CONTROL" ? '{"key": "value"}' : ""}
                  value={data.extraConfig ?? ""}
                  onChange={(e) => setData({ ...data, extraConfig: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
            )}

            {provider === "ANNY" && isConfigured && areas && areas.length > 0 && annyServiceNames.length > 0 && (
              <>
                <Separator className="dark:bg-slate-800" />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-slate-500" />
                    <Label className="text-sm font-semibold">Service-Zuordnung</Label>
                  </div>
                  <p className="text-xs text-slate-500">
                    Ordne anny Services einer Resource zu. Nach dem Speichern werden beim nächsten Sync die Tickets automatisch zugeordnet. Die Zuordnung von anny Ressourcen erfolgt im Menüpunkt „Resourcen".
                  </p>
                  <div className="space-y-2">
                    {annyServiceNames.map((svc) => (
                      <div key={svc} className="flex items-center gap-3">
                        <span className="text-sm text-slate-700 dark:text-slate-300 min-w-0 flex-1 truncate">{svc}</span>
                        <Select
                          value={annyMappings[svc] != null ? String(annyMappings[svc]) : "__none__"}
                          onValueChange={(v) => updateMapping(svc, v === "__none__" ? null : Number(v))}
                        >
                          <SelectTrigger className="w-48 h-8 text-xs">
                            <SelectValue placeholder="Keine Resource" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">– Keine Resource –</SelectItem>
                            {areas.map((area) => (
                              <SelectItem key={area.id} value={String(area.id)}>
                                {area.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {provider === "ANNY" && isConfigured && annyServiceNames.length === 0 && (
              <p className="text-xs text-slate-400 italic">
                Erst synchronisieren, um anny Services zu erkennen und Resourcen zuzuordnen.
              </p>
            )}

            {error && (
              <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            {syncResult && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-lg">
                Sync abgeschlossen: {syncResult}
              </p>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleting || !initialData}
                className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Entfernen
              </Button>
              <div className="flex items-center gap-2">
                {syncEndpoint && isConfigured && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSync}
                    disabled={syncing}
                    className="min-w-24"
                  >
                    <RefreshCw className={cn("h-4 w-4 mr-1.5", syncing && "animate-spin")} />
                    {syncing ? "Synchronisiere..." : "Jetzt synchronisieren"}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || !data.token}
                  className={cn(
                    "min-w-24",
                    saved ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"
                  )}
                >
                  {saving ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : saved ? (
                    <><CheckCircle2 className="h-4 w-4 mr-1.5" />Gespeichert</>
                  ) : (
                    <><Save className="h-4 w-4 mr-1.5" />Speichern</>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}
