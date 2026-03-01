"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle2, Circle, Trash2, Save, ChevronDown, ChevronUp, RefreshCw, Copy } from "lucide-react";
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
  tokenOptional?: boolean;
}

const SYNC_ENDPOINTS: Record<string, { method: string; url: string }> = {
  ANNY: { method: "POST", url: "/api/integrations/anny" },
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
      token: "API Token (nicht nötig – Wakesys-Abfrage erfolgt ohne Token)",
      baseUrl: "Base URL (z. B. https://twincable-beckum.wakesys.com)",
      extraConfig: "Zusatz (JSON, optional): account, interfaceIds [2,3,4], interfaceType",
    },
    tokenOptional: true,
  },
  BINARYTEC: {
    label: "Binarytec",
    description: "Zugangskontrolle & Ticket-Synchronisation",
    color: "bg-orange-500",
    fields: {
      token: "API Token",
      baseUrl: "Base URL (z. B. https://192.168.251.50:444)",
      extraConfig: "Zusatz (JSON): resourceId für Check-Access / Scan-Fallback",
    },
  },
  EMP_CONTROL: {
    label: "emp-control",
    description: "Personalmanagement-System (bidirektional)",
    color: "bg-indigo-500",
    fields: {
      token: "API Token (optional – nur für bidirektionale Sync)",
      baseUrl: "System-URL (optional – nur für bidirektionale Sync)",
      extraConfig: "Zusatz-Konfiguration (JSON, optional)",
    },
    tokenOptional: true,
  },
};

interface IntegrationCardProps {
  provider: string;
  initialData: ApiConfigData | null;
}

export function IntegrationCard({ provider, initialData }: IntegrationCardProps) {
  const meta = PROVIDER_META[provider];
  const [open, setOpen] = useState(!!initialData);
  const [data, setData] = useState<ApiConfigData>(
    initialData ?? { provider, token: "", eventId: "", baseUrl: "", extraConfig: "" }
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<{ annyName: string; count: number; customerSample: string[] }[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const isConfigured =
    provider === "WAKESYS" ? !!initialData?.baseUrl?.trim()
    : provider === "EMP_CONTROL" ? !!initialData
    : !!initialData?.token;

  const webhookSecret = (provider === "EMP_CONTROL" || provider === "ANNY") && data.extraConfig
    ? (() => { try { const e = JSON.parse(data.extraConfig); return e?.webhookSecret ?? null; } catch { return null; } })()
    : null;
  const webhookUrl = typeof window !== "undefined"
    ? provider === "EMP_CONTROL"
      ? `${window.location.origin}/api/webhook/emp-control`
      : provider === "ANNY"
        ? `${window.location.origin}/api/integrations/anny/webhook`
        : ""
    : "";

  const empControlApiDescription = (
    <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 mt-2">
      <p className="font-medium text-slate-600 dark:text-slate-300">Webhook-API</p>
      <p><strong>POST</strong> {webhookUrl || "/api/webhook/emp-control"}</p>
      <p><strong>Header:</strong> <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">Authorization: Bearer &lt;Secret&gt;</code> oder <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">X-Webhook-Secret: &lt;Secret&gt;</code></p>
      <p><strong>Body (JSON):</strong> <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded text-[10px] break-all">{`{ "employees": [ { "id": 1, "firstName", "lastName", "rfidCode", "contractStart", "contractEnd", "active", "areaIds": [1, 2, 3] } ] }`}</code></p>
      <p><strong>Ressourcen:</strong> <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">areaIds</code> (Array) – IDs der Access Areas, bei denen der Mitarbeiter Zugang hat. Alternativ: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">areaId</code> (einzeln) oder <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">resourceIds</code>.</p>
      <p>Der Webhook legt pro Mitarbeiter ein Ticket an (uuid: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">emp-&lt;id&gt;</code>) und verknüpft es mit allen angegebenen Ressourcen.</p>
    </div>
  );

  const annyApiDescription = (
    <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 mt-2">
      <p className="font-medium text-slate-600 dark:text-slate-300">Webhook-API</p>
      <p><strong>POST</strong> {webhookUrl || "/api/integrations/anny/webhook"}</p>
      <p><strong>Header:</strong> <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">Authorization: Bearer &lt;Secret&gt;</code> oder <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">X-Webhook-Secret: &lt;Secret&gt;</code></p>
      <p><strong>Body (JSON):</strong></p>
      <ul className="list-disc list-inside space-y-0.5 pl-1">
        <li><code className="bg-slate-100 dark:bg-slate-800 px-1 rounded text-[10px]">{`{ "booking": { ... } }`}</code> — einzelne Buchung</li>
        <li><code className="bg-slate-100 dark:bg-slate-800 px-1 rounded text-[10px]">{`{ "bookings": [ ... ] }`}</code> — mehrere Buchungen</li>
        <li><code className="bg-slate-100 dark:bg-slate-800 px-1 rounded text-[10px]">{`{ "data": { "booking": { ... } } }`}</code> — anny.co Webhook-Format</li>
      </ul>
      <p><strong>Booking-Felder:</strong> <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded text-[10px]">id, number, start_date, end_date, status, customer (id, full_name, first_name, last_name), resource (id, name), service (id, name)</code></p>
      <p>Der Webhook ordnet Buchungen automatisch Services, Abos oder Bereichen zu und erstellt/aktualisiert Tickets. Stornierte Buchungen werden ignoriert.</p>
    </div>
  );

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
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
        const updated = await res.json();
        setData(updated);
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
    setUnmapped([]);
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
        if (Array.isArray(json.unmapped) && json.unmapped.length > 0) {
          setUnmapped(json.unmapped);
        }
        setTimeout(() => setSyncResult(null), 12000);

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
              {provider === "EMP_CONTROL" && (
                <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <p><strong>Webhook:</strong> POST <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">{webhookUrl || "/api/webhook/emp-control"}</code> – Mitarbeiter pushen. Details beim Öffnen.</p>
                </div>
              )}
              {provider === "ANNY" && isConfigured && (
                <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <p><strong>Webhook:</strong> POST <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">{webhookUrl || "/api/integrations/anny/webhook"}</code> – Buchungen empfangen. Details beim Öffnen.</p>
                </div>
              )}
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
                  placeholder={provider === "EMP_CONTROL" ? '{"key": "value"}' : provider === "WAKESYS" ? '{"interfaceIds": [2, 3, 4]}' : provider === "BINARYTEC" ? '{"resourceId": "1"}' : ""}
                  value={data.extraConfig ?? ""}
                  onChange={(e) => setData({ ...data, extraConfig: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
            )}

            {provider === "BINARYTEC" && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Binarytec API (nur Check, kein Sync)</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-500">
                  Wenn Binarytec konfiguriert ist, prüft der Raspberry Pi Scans <strong>nur</strong> per Binarytec (Check-Access). Keine EMP-Tickets, kein Ticket-Sync. <strong>resourceId</strong> im Zusatz (JSON) ist erforderlich.
                </p>
              </div>
            )}

            {provider === "WAKESYS" && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Interface-IDs (Wakesys)</p>
                <ul className="text-[11px] text-slate-500 dark:text-slate-500 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
                  <li>1 = Admin</li>
                  <li>2 = Seilbahn A</li>
                  <li>3 = Seilbahn B</li>
                  <li>4 = Übungslift</li>
                  <li>5 = Browser</li>
                  <li>6 = Kasse 1</li>
                  <li>7 = Kasse 2</li>
                  <li>8 = Kasse Büro</li>
                  <li>19 = Drehkreuz</li>
                </ul>
                <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-1">
                  Zusatz z. B.: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">{`{"interfaceIds": [2, 3, 4]}`}</code> (Reihenfolge = Fallback)
                </p>
              </div>
            )}

            {(provider === "EMP_CONTROL" || provider === "ANNY") && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 space-y-3">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {provider === "EMP_CONTROL"
                    ? "Webhook – Mitarbeiter von emp-control pushen"
                    : "Webhook – Buchungen von anny.co empfangen"}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-500">
                  {provider === "ANNY"
                    ? "In anny.co diese URL als Webhook eintragen. Bei neuer/geänderter Buchung sendet anny.co automatisch einen POST und EMP legt daraus ein Ticket an oder aktualisiert es."
                    : "emp-control sendet Mitarbeiterdaten per POST an diesen Webhook."}
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-slate-500 shrink-0">URL</Label>
                    <Input
                      readOnly
                      value={webhookUrl}
                      className="font-mono text-xs h-8 bg-white dark:bg-slate-900"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => copyToClipboard(webhookUrl, "wh-url")}
                    >
                      {copied === "wh-url" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-slate-500 shrink-0">Secret</Label>
                    {webhookSecret ? (
                      <>
                        <Input
                          readOnly
                          type="password"
                          value={webhookSecret}
                          className="font-mono text-xs h-8 bg-white dark:bg-slate-900"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => copyToClipboard(webhookSecret, "wh-secret")}
                        >
                          {copied === "wh-secret" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">Nach dem Speichern wird ein Webhook-Secret erzeugt und hier angezeigt.</span>
                    )}
                  </div>
                </div>
                {provider === "EMP_CONTROL" ? empControlApiDescription : annyApiDescription}
              </div>
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

            {unmapped.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <p className="text-xs font-medium">
                    {unmapped.length} ANNY-Service{unmapped.length > 1 ? "s" : ""} ohne Zuordnung — Buchungen wurden nicht importiert
                  </p>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  Erstelle einen Service unter &quot;Services&quot; und hinterlege den ANNY-Namen, dann erneut synchronisieren.
                </p>
                <div className="space-y-1">
                  {unmapped.map((u) => (
                    <div key={u.annyName} className="flex items-center justify-between text-xs bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 border border-amber-100 dark:border-amber-900/50">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{u.annyName}</span>
                        {u.customerSample.length > 0 && (
                          <span className="text-slate-400 ml-1.5">({u.customerSample.join(", ")}{u.count > u.customerSample.length ? ", …" : ""})</span>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0 ml-2">
                        {u.count} Buchung{u.count > 1 ? "en" : ""}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
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
                {syncEndpoint && isConfigured && (provider !== "EMP_CONTROL" || !!data.token) && (
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
                  disabled={saving || (provider === "WAKESYS" ? !data.baseUrl?.trim() : provider === "EMP_CONTROL" ? false : !data.token)}
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
