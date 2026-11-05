"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CheckCircle2, Circle, Trash2, Save, ChevronDown, ChevronUp, RefreshCw, Copy, Search, XCircle } from "lucide-react";
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
  fields: {
    token: string;
    eventId?: string;
    baseUrl?: string;
    extraConfig?: string;
  };
  tokenOptional?: boolean;
}

/** `extraConfig` als Objekt lesen; unlesbares JSON zaehlt als leer. */
function readExtra(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Einen Schluessel in `extraConfig` setzen, den Rest unveraendert lassen. */
function writeExtra(raw: string | null | undefined, key: string, value: string): string {
  return JSON.stringify({ ...readExtra(raw), [key]: value });
}

const SYNC_ENDPOINTS: Record<string, { method: string; url: string }> = {
  ANNY: { method: "POST", url: "/api/integrations/anny" },
  EMP_CONTROL: { method: "GET", url: "/api/integrations/emp-control" },
  NUKI: { method: "POST", url: "/api/integrations/nuki" },
  LOQED: { method: "POST", url: "/api/integrations/loqed" },
};

/**
 * Anbieter, die uns von aussen aufrufen. Fehlt ein Eintrag, zeigt die Karte
 * keinen Webhook-Abschnitt.
 */
const WEBHOOK_INFO: Record<string, { path: string; title: string; hint: string }> = {
  EMP_CONTROL: {
    path: "/api/webhook/emp-control",
    title: "Webhook – Mitarbeiter von emp-control pushen",
    hint: "emp-control sendet Mitarbeiterdaten per POST an diesen Webhook.",
  },
  ANNY: {
    path: "/api/integrations/anny/webhook",
    title: "Webhook – Buchungen von anny.co empfangen",
    hint: "In anny.co diese URL als Webhook eintragen. Bei neuer/geänderter Buchung sendet anny.co automatisch einen POST und EMP legt daraus ein Ticket an oder aktualisiert es.",
  },
  NUKI: {
    path: "/api/integrations/nuki/webhook",
    title: "Webhook – Tür-Events von Nuki empfangen",
    hint: "Wird beim Sync automatisch bei Nuki registriert. Bei jedem Lock-/Unlock-Event sendet Nuki einen POST – EMP loggt das als Scan und aktualisiert den Akkustand.",
  },
  LOQED: {
    path: "/api/integrations/loqed/webhook",
    title: "Webhook – Tür-Events von LOQED empfangen",
    hint: "Diese URL auf app.loqed.com unter API als ausgehenden Webhook eintragen – LOQED registriert sie nicht selbst. Danach meldet das Schloss jede Riegelbewegung sofort, statt dass EMP nachfragen muss: Der Statusabruf von LOQED ist auf zwölf Anfragen pro Tag begrenzt.",
  },
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  ANNY: {
    label: "anny.co",
    description: "Buchungsplattform – synchronisiert Buchungen als Tickets",
    fields: {
      token: "Access Token",
      baseUrl: "Base URL (optional, Standard: https://b.anny.co)",
    },
  },
  WAKESYS: {
    label: "Wakesys",
    description: "Wakepark Management & Ticketsystem",
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
    fields: {
      token: "API Token",
      baseUrl: "Base URL (z. B. https://192.168.251.50:444)",
      extraConfig: "Zusatz (JSON): resourceId für Check-Access / Scan-Fallback",
    },
  },
  EMP_CONTROL: {
    label: "emp-control",
    description: "Personalmanagement-System (bidirektional)",
    fields: {
      token: "API Token (optional – nur für bidirektionale Sync)",
      baseUrl: "System-URL (optional – nur für bidirektionale Sync)",
      extraConfig: "Zusatz-Konfiguration (JSON, optional)",
    },
    tokenOptional: true,
  },
  NUKI: {
    label: "Nuki",
    description: "Smart Locks – Sync, Steuerung & Live-Events via Nuki Web API",
    fields: {
      token: "Nuki Web API Token (Nuki Web → Account → API)",
    },
  },
  LOQED: {
    label: "LOQED",
    description: "Türschlösser – Öffnen, Entriegeln, Abschließen über die LOQED Integrations-API",
    fields: {
      token: "Persönlicher Zugriffstoken (integrations.production.loqed.com/personal-access-tokens, LOQED-Konto als Admin)",
    },
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
  // Rückfrage vor dem Entfernen als AlertDialog statt Browser-confirm (docs/design-regeln.md, Abschnitte 16 und 18).
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<{ annyName: string; count: number; customerSample: string[] }[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [testCode, setTestCode] = useState("");
  const [testing, setTesting] = useState(false);
  const [merging, setMerging] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    code?: string;
    name?: string | null;
    picture?: string | null;
    age?: number | null;
    category?: string | null;
    cardName?: string | null;
    validUntil?: string | null;
    interfaceNames?: string[] | null;
    message?: string;
    matchingTickets?: { id: number; name: string; firstName: string | null; lastName: string | null; ticketTypeName: string | null; rfidCode: string | null; status: string; subscriptionId: number | null }[];
  } | null>(null);

  const isConfigured =
    provider === "WAKESYS" ? !!initialData?.baseUrl?.trim()
    : provider === "EMP_CONTROL" ? !!initialData
    : !!initialData?.token;

  const webhook = WEBHOOK_INFO[provider];

  const webhookSecret = webhook && data.extraConfig
    ? (() => { try { const e = JSON.parse(data.extraConfig); return e?.webhookSecret ?? null; } catch { return null; } })()
    : null;
  const webhookBaseUrl = typeof window !== "undefined" && webhook
    ? `${window.location.origin}${webhook.path}`
    : "";
  // Bei emp-control steht das Geheimnis nicht in der URL, sondern im Aufruf.
  const webhookUrl = provider !== "EMP_CONTROL" && webhookSecret
    ? `${webhookBaseUrl}?secret=${webhookSecret}`
    : webhookBaseUrl;

  const empControlApiDescription = (
    <div className="text-[11px] text-muted-foreground space-y-1 mt-2 wrap-anywhere">
      <p className="font-medium text-muted-foreground">Webhook-API</p>
      <p><strong>POST</strong> {webhookUrl || "/api/webhook/emp-control"}</p>
      <p><strong>Header:</strong> <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;Secret&gt;</code> oder <code className="bg-muted px-1 rounded">X-Webhook-Secret: &lt;Secret&gt;</code></p>
      <p><strong>Body (JSON):</strong> <code className="bg-muted px-1 rounded break-all">{`{ "employees": [ { "id": 1, "firstName", "lastName", "rfidCode", "contractStart", "contractEnd", "active", "areaIds": [1, 2, 3], "deviceIds": [22] } ] }`}</code></p>
      <p><strong>Ressourcen:</strong> <code className="bg-muted px-1 rounded">areaIds</code> (Array) – IDs der Access Areas, bei denen der Mitarbeiter Zugang hat. Alternativ: <code className="bg-muted px-1 rounded">areaId</code> (einzeln) oder <code className="bg-muted px-1 rounded">resourceIds</code>. IDs kommen aus <code className="bg-muted px-1 rounded">GET /api/areas</code>.</p>
      <p><strong>Einzelne Geräte:</strong> <code className="bg-muted px-1 rounded">deviceIds</code> (Array, alternativ <code className="bg-muted px-1 rounded">deviceId</code>) – für Mitarbeiter, die genau ein Gerät bedienen sollen, ohne dass dafür ein eigener Bereich nötig ist. Wirkt <em>zusätzlich</em> zu den Bereichen und gilt in der Mitarbeiter-App wie am RFID-Leser. IDs kommen aus <code className="bg-muted px-1 rounded">GET /api/devices</code>.</p>
      <p>Der Webhook legt pro Mitarbeiter ein Ticket an (uuid: <code className="bg-muted px-1 rounded">emp-&lt;id&gt;</code>) und verknüpft es mit allen angegebenen Ressourcen.</p>
      <p><strong>Sync-Regel:</strong> Fehlt <code className="bg-muted px-1 rounded">areaIds</code> bzw. <code className="bg-muted px-1 rounded">deviceIds</code> im Payload, bleibt die bestehende Zuweisung unverändert. Eine leere Liste entfernt alle Einträge. Unbekannte IDs werden übersprungen und in der Antwort unter <code className="bg-muted px-1 rounded">unknown</code> zurückgemeldet.</p>
    </div>
  );

  const nukiApiDescription = (
    <div className="text-[11px] text-muted-foreground space-y-1 mt-2 wrap-anywhere">
      <p className="font-medium text-muted-foreground">Nuki Web API</p>
      <p>1. Token unter <a className="underline" href="https://web.nuki.io" target="_blank" rel="noreferrer">web.nuki.io</a> → Account → API generieren und oben einfügen.</p>
      <p>2. Auf <strong>Synchronisieren</strong> klicken – alle Smart Locks aus Nuki werden automatisch als Geräte (Typ <code className="bg-muted px-1 rounded">NUKI_SMARTLOCK</code>, Kategorie <em>Tür</em>) angelegt und mit Akkustand/Firmware befüllt.</p>
      <p>3. Sync registriert automatisch einen Webhook bei Nuki (sofern die Seite über HTTPS erreichbar ist) – Tür-Events landen dann als <em>Scan</em> in EMP. URL und Secret siehst du unten.</p>
      <p><strong>Aktionen:</strong> Über das Geräte-Menü kannst du die Tür auf/zu schalten (Web-API: <code className="bg-muted px-1 rounded">unlatch</code>/<code className="bg-muted px-1 rounded">lock</code>).</p>
      <p><strong>Voraussetzung:</strong> Smart Lock Pro (4. Gen) oder Ultra mit WLAN bzw. Smart Lock + Nuki Bridge.</p>
    </div>
  );

  const annyApiDescription = (
    <div className="text-[11px] text-muted-foreground space-y-1 mt-2 wrap-anywhere">
      <p className="font-medium text-muted-foreground">Webhook-API</p>
      <p><strong>POST</strong> {webhookUrl || "/api/integrations/anny/webhook"}</p>
      <p><strong>Auth:</strong> Secret ist in der URL enthalten (<code className="bg-muted px-1 rounded">?secret=…</code>). Alternativ als Header: <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;Secret&gt;</code></p>
      <p><strong>Body (JSON):</strong></p>
      <ul className="list-disc list-inside space-y-0.5 pl-1">
        <li><code className="bg-muted px-1 rounded">{`{ "booking": { ... } }`}</code> — einzelne Buchung</li>
        <li><code className="bg-muted px-1 rounded">{`{ "bookings": [ ... ] }`}</code> — mehrere Buchungen</li>
        <li><code className="bg-muted px-1 rounded">{`{ "data": { "booking": { ... } } }`}</code> — anny.co Webhook-Format</li>
      </ul>
      <p><strong>Booking-Felder:</strong> <code className="bg-muted px-1 rounded">id, number, start_date, end_date, status, customer (id, full_name, first_name, last_name), resource (id, name), service (id, name)</code></p>
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
        const fe = err.error?.fieldErrors as Record<string, string[]> | undefined;
        const fromFields = fe ? (Object.values(fe).flat() as string[]).find(Boolean) : undefined;
        const fromForm = Array.isArray(err.error?.formErrors) ? err.error.formErrors[0] : undefined;
        setError(
          typeof err.error === "string"
            ? err.error
            : (fromFields ?? fromForm ?? "Speichern fehlgeschlagen"),
        );
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
        if (json.errors) parts.push(`${json.errors} Fehler`);
        if (json.resources) parts.push(`${json.resources} Ressourcen`);
        if (json.total !== undefined && json.groups !== undefined) {
          parts.push(`${json.total} Buchungen → ${json.groups} Tickets`);
        } else if (json.total !== undefined) {
          parts.push(`${json.total} gesamt`);
        }
        if (json.syncWindowDays) {
          parts.push(`letzte ${json.syncWindowDays} Tage`);
        }
        const suffix: string[] = [];
        if (json.account && typeof json.account === "object") {
          const acc = json.account as { email?: string; name?: string; accountId?: number };
          const accLabel = acc.email || acc.name || (acc.accountId != null ? `#${acc.accountId}` : null);
          if (accLabel) suffix.push(`Account: ${accLabel}`);
        }
        if (json.message && typeof json.message === "string") {
          suffix.push(json.message);
        }
        const summary = parts.length ? parts.join(", ") : "Keine neuen Daten";
        setSyncResult(suffix.length ? `${summary} — ${suffix.join(" · ")}` : summary);
        if (Array.isArray(json.unmapped) && json.unmapped.length > 0) {
          setUnmapped(json.unmapped);
        }
        setTimeout(() => setSyncResult(null), 20000);

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

  async function handleRfidMerge(ticketId: number) {
    if (!testResult?.code) return;
    setMerging(ticketId);
    try {
      const res = await fetch("/api/integrations/wakesys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, rfidCode: testResult.code, profileImage: testResult.picture }),
      });
      if (res.ok) {
        setTestResult((prev) => prev ? {
          ...prev,
          matchingTickets: prev.matchingTickets?.map((t) =>
            t.id === ticketId ? { ...t, rfidCode: testResult.code! } : t
          ),
        } : prev);
      }
    } finally {
      setMerging(null);
    }
  }

  async function handleWakesysTest() {
    if (!testCode.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/integrations/wakesys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: testCode.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setTestResult({ valid: false, message: json.error || "Fehler" });
      } else {
        setTestResult({
          valid: json.valid,
          code: json.code,
          name: json.name,
          picture: json.picture,
          age: json.age,
          category: json.category,
          cardName: json.cardName,
          validUntil: json.validUntil,
          interfaceNames: json.interface,
          message: json.message,
          matchingTickets: json.matchingTickets,
        });
      }
    } catch {
      setTestResult({ valid: false, message: "Netzwerkfehler" });
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/settings/integrations?provider=${provider}`, { method: "DELETE" });
      setData({ provider, token: "", eventId: "", baseUrl: "", extraConfig: "" });
      setOpen(false);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        {/* Die ganze Kopfzeile ist eine Taste: per Tastatur erreichbar, Zustand über aria-expanded (Abschnitt 12). */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={open ? `integration-${provider}` : undefined}
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-control text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Kürzel im Glas-Chip in Akzentfarbe statt eigener Markenfarbe je Anbieter (docs/design-regeln.md, Abschnitt 3). */}
            <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-glass-tile ring-1 ring-inset ring-glass-border text-xs font-bold text-primary dark:text-foreground">
              {meta.label.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {meta.label}
                {isConfigured ? (
                  <Badge variant="success">
                    <CheckCircle2 className="h-3 w-3" /> Verbunden
                  </Badge>
                ) : (
                  <Badge variant="neutral">
                    <Circle className="h-3 w-3" /> Nicht konfiguriert
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-0.5">{meta.description}</CardDescription>
              {provider === "EMP_CONTROL" && (
                <div className="mt-2 text-[11px] text-muted-foreground wrap-anywhere">
                  <p><strong>Webhook:</strong> POST <code className="bg-muted px-1 rounded">{webhookUrl || "/api/webhook/emp-control"}</code> – Mitarbeiter pushen. Details beim Öffnen.</p>
                </div>
              )}
              {provider === "ANNY" && isConfigured && (
                <div className="mt-2 text-[11px] text-muted-foreground wrap-anywhere">
                  <p><strong>Webhook:</strong> POST <code className="bg-muted px-1 rounded">{webhookUrl || "/api/integrations/anny/webhook"}</code> – Buchungen empfangen. Details beim Öffnen.</p>
                </div>
              )}
              {provider === "NUKI" && isConfigured && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  <p><strong>Sync:</strong> Smart Locks → Geräte. <strong>Webhook:</strong> Tür-Events → Scans. Details beim Öffnen.</p>
                </div>
              )}
              {provider === "LOQED" && isConfigured && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  <p><strong>Sync:</strong> Schlösser → Geräte. <strong>Webhook:</strong> Riegelbewegungen → Scans. Details beim Öffnen.</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
            {initialData?.lastUpdate && (
              <span className="text-xs hidden sm:flex items-center gap-1 tabular-nums">
                <RefreshCw className="h-3 w-3" />
                {fmtDate(initialData.lastUpdate)}
              </span>
            )}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>
      </CardHeader>

      {open && (
        <>
          <Separator />
          <CardContent id={`integration-${provider}`} className="space-y-4">
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

            {provider === "EMP_CONTROL" && (
              <div className="space-y-2">
                <Label htmlFor="EMP_CONTROL-monitor">Live-Monitor-Link (für „Wer arbeitet gerade?“ im Hub)</Label>
                <Input
                  id="EMP_CONTROL-monitor"
                  type="password"
                  placeholder="https://…/monitor?token=…"
                  value={String(readExtra(data.extraConfig).monitorUrl ?? "")}
                  onChange={(e) => setData({ ...data, extraConfig: writeExtra(data.extraConfig, "monitorUrl", e.target.value.trim()) })}
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  In emp-control unter Terminals &amp; Standorte einen Live-Monitor anlegen und dessen Link hier einfügen. Der Hub erfährt darüber, wer eingestempelt ist und wer heute noch Schicht hat; der Token bleibt in der Cloud.
                </p>
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
                  className="font-mono"
                />
              </div>
            )}

            {provider === "BINARYTEC" && (
              <div className="glass-tile p-3 space-y-2">
                <p className="text-label">Binarytec API (nur Check, kein Sync)</p>
                <p className="text-[11px] text-muted-foreground">
                  Wenn Binarytec konfiguriert ist, prüft der Raspberry Pi Scans <strong>nur</strong> per Binarytec (Check-Access). Keine EMP-Tickets, kein Ticket-Sync. <strong>resourceId</strong> im Zusatz (JSON) ist erforderlich.
                </p>
              </div>
            )}

            {provider === "WAKESYS" && (
              <div className="glass-tile p-3 space-y-2">
                <p className="text-label">Interface-IDs (Wakesys)</p>
                <ul className="text-[11px] text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
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
                <p className="text-[11px] text-muted-foreground mt-1">
                  Zusatz z. B.: <code className="bg-muted px-1 rounded">{`{"interfaceIds": [2, 3, 4]}`}</code> (Reihenfolge = Fallback)
                </p>
              </div>
            )}

            {provider === "WAKESYS" && isConfigured && (
              <div className="glass-tile p-3 space-y-3">
                <p className="text-label">RFID / Code testen</p>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="RFID-Code eingeben…"
                    value={testCode}
                    onChange={(e) => setTestCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleWakesysTest()}
                    className="font-mono max-sm:h-11"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleWakesysTest}
                    disabled={testing || !testCode.trim()}
                    className="shrink-0 h-9 max-sm:h-11"
                  >
                    {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    {testing ? "" : "Prüfen"}
                  </Button>
                </div>
                {testResult && (
                  <Notice
                    tone={testResult.valid ? "success" : "danger"}
                    icon={testResult.valid ? CheckCircle2 : XCircle}
                    compact
                    title={testResult.valid ? "Gültig" : "Nicht gültig"}
                  >
                    {testResult.valid ? (
                      <div className="flex items-start gap-3">
                        {testResult.picture && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={testResult.picture} alt="" className="h-14 w-14 rounded-lg object-cover shrink-0 border border-border" />
                        )}
                        <div className="space-y-0.5">
                          {testResult.name && <p><strong>Name:</strong> {testResult.name}{testResult.age != null && <span className="ml-1 tabular-nums">({testResult.age} Jahre)</span>}</p>}
                          {testResult.cardName && <p><strong>Karte:</strong> {testResult.cardName}</p>}
                          {testResult.category && <p><strong>Kategorie:</strong> {testResult.category}</p>}
                          {testResult.validUntil && <p><strong>Gültig bis:</strong> {testResult.validUntil}</p>}
                          {testResult.interfaceNames && <p><strong>Interface:</strong> {testResult.interfaceNames.join(", ")}</p>}
                        </div>
                      </div>
                    ) : testResult.message ? (
                      <p>{testResult.message}</p>
                    ) : null}
                  </Notice>
                )}
                {testResult?.valid && testResult.matchingTickets && testResult.matchingTickets.length > 0 && (
                  <div className="glass-tile p-3 space-y-2">
                    <p className="text-label tabular-nums">
                      {testResult.matchingTickets.length} passende{testResult.matchingTickets.length === 1 ? "s" : ""} Ticket{testResult.matchingTickets.length === 1 ? "" : "s"} im System
                    </p>
                    <div className="space-y-1.5">
                      {testResult.matchingTickets.map((t) => (
                        <div key={t.id} className="flex items-center justify-between gap-2 rounded-control bg-glass-tile px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {[t.firstName, t.lastName].filter(Boolean).join(" ") || t.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {t.ticketTypeName || (t.subscriptionId ? "Abo" : "Ticket")}
                              {t.rfidCode && <> · RFID: <code className="bg-muted px-1 rounded">{t.rfidCode}</code></>}
                            </p>
                          </div>
                          {t.rfidCode === testResult.code ? (
                            <Badge variant="success" className="shrink-0">
                              <CheckCircle2 className="h-3 w-3" /> Verknüpft
                            </Badge>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleRfidMerge(t.id)}
                              disabled={merging === t.id}
                              className="shrink-0 max-sm:h-11"
                            >
                              {merging === t.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : "RFID zuweisen"}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {testResult?.valid && testResult.matchingTickets?.length === 0 && (
                  <p className="text-xs text-muted-foreground">Kein passendes Ticket im System gefunden.</p>
                )}
              </div>
            )}

            {webhook && (
              <div className="glass-tile p-3 space-y-3">
                <p className="text-label">{webhook.title}</p>
                <p className="text-[11px] text-muted-foreground">{webhook.hint}</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-muted-foreground shrink-0">URL</Label>
                    <Input
                      readOnly
                      value={webhookUrl}
                      className="font-mono max-sm:h-11"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 max-sm:size-11"
                      onClick={() => copyToClipboard(webhookUrl, "wh-url")}
                      title="URL kopieren"
                      aria-label="URL kopieren"
                    >
                      {copied === "wh-url" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-muted-foreground shrink-0">Secret</Label>
                    {webhookSecret ? (
                      <>
                        <Input
                          readOnly
                          type="password"
                          value={webhookSecret}
                          className="font-mono max-sm:h-11"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0 max-sm:size-11"
                          onClick={() => copyToClipboard(webhookSecret, "wh-secret")}
                          title="Secret kopieren"
                          aria-label="Secret kopieren"
                        >
                          {copied === "wh-secret" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Nach dem Speichern wird ein Webhook-Secret erzeugt und hier angezeigt.</span>
                    )}
                  </div>
                </div>
                {provider === "EMP_CONTROL"
                  ? empControlApiDescription
                  : provider === "ANNY"
                    ? annyApiDescription
                    : nukiApiDescription}
              </div>
            )}

            {error && <Notice tone="danger" compact title={error} />}

            {syncResult && <Notice tone="success" compact title={`Sync abgeschlossen: ${syncResult}`} />}

            {unmapped.length > 0 && (
              <Notice
                tone="warning"
                compact
                title={<>{unmapped.length} ANNY-Service{unmapped.length > 1 ? "s" : ""} ohne Zuordnung — Buchungen wurden nicht importiert</>}
              >
                <p>
                  Erstelle einen Service unter &quot;Services&quot; und hinterlege den ANNY-Namen, dann erneut synchronisieren.
                </p>
                <div className="mt-2 space-y-1">
                  {unmapped.map((u) => (
                    <div key={u.annyName} className="flex items-center justify-between gap-2 rounded-control bg-glass-tile px-2.5 py-1.5">
                      <div className="min-w-0">
                        <span className="font-medium text-foreground">{u.annyName}</span>
                        {u.customerSample.length > 0 && (
                          <span className="text-muted-foreground ml-1.5">({u.customerSample.join(", ")}{u.count > u.customerSample.length ? ", …" : ""})</span>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0 tabular-nums">
                        {u.count} Buchung{u.count > 1 ? "en" : ""}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Notice>
            )}

            {/* Auf dem Handy umbrechen, statt über den Rand zu laufen. */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting || !initialData}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 max-sm:h-11"
              >
                <Trash2 className="h-4 w-4" />
                Entfernen
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                {syncEndpoint && isConfigured && (provider !== "EMP_CONTROL" || !!data.token) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSync}
                    disabled={syncing}
                    className="min-w-24 max-sm:h-11"
                  >
                    <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                    {syncing ? "Synchronisiere..." : "Jetzt synchronisieren"}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || (provider === "WAKESYS" ? !data.baseUrl?.trim() : provider === "EMP_CONTROL" ? false : !data.token)}
                  className={cn(
                    "min-w-24 max-sm:h-11",
                    saved && "bg-success text-success-foreground hover:bg-success/90 shadow-none"
                  )}
                >
                  {saving ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : saved ? (
                    <><CheckCircle2 className="h-4 w-4" />Gespeichert</>
                  ) : (
                    <><Save className="h-4 w-4" />Speichern</>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={(o) => { if (!deleting) setConfirmDelete(o); }}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Möchtest du die {meta.label}-Integration wirklich löschen?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                // Offen lassen, bis das Entfernen fertig ist; handleDelete schließt den Dialog.
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
