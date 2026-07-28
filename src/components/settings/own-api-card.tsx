"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, Info, Loader2, RefreshCw, Save } from "lucide-react";

interface OwnApiCardProps {
  baseUrl: string;
  apiToken: string;
}

const ENDPOINTS = [
  { method: "GET", path: "/api/areas", desc: "Ressourcen (Zugangsbereiche) auflisten" },
  {
    method: "GET",
    path: "/api/webhook/utilization?date=YYYY-MM-DD",
    desc: "Auslastung pro Ressource (Tickets am Tag / personLimit); optional &all=1 für alle Bereiche",
  },
  { method: "GET", path: "/api/devices", desc: "Geräte auflisten; jedes Gerät nennt in actions seine erlaubten Befehle" },
  { method: "GET", path: "/api/devices/[id]", desc: "Einzelnes Gerät abrufen (inkl. actions)" },
  {
    method: "POST",
    path: "/api/devices/[id]/action",
    desc: "Gerät steuern – Zutritt und Schalter: open, emergency, reset, deactivate; Markise/Rolltor: open, stop, close",
  },
  {
    method: "GET",
    path: "/api/lost-items?filter=open&kind=found&q=...",
    desc: "Fundsachen & Verlustmeldungen suchen (Bilder via &withImages=1)",
  },
  {
    method: "POST",
    path: "/api/lost-items",
    desc: 'Eintrag anlegen – Fundsache: {"description","foundDate"}; Verlustmeldung: {"kind":"LOST_REPORT","description","reporterName","callbackPhone"}',
  },
  { method: "PATCH", path: "/api/lost-items/[id]", desc: 'Eintrag ändern, z. B. {"pickedUp": true}' },
];

export function OwnApiCard({ baseUrl, apiToken }: OwnApiCardProps) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [displayToken, setDisplayToken] = useState(apiToken);
  const [customToken, setCustomToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setDisplayToken(apiToken);
  }, [apiToken]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  async function patchToken(body: Record<string, unknown>) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fe = data.error?.fieldErrors as Record<string, string[]> | undefined;
        const fromFields = fe ? (Object.values(fe).flat() as string[]).find(Boolean) : undefined;
        const fromForm = Array.isArray(data.error?.formErrors) ? data.error.formErrors[0] : undefined;
        setFeedback({
          type: "err",
          text:
            typeof data.error === "string"
              ? data.error
              : (fromFields ?? fromForm ?? "Speichern fehlgeschlagen"),
        });
        return;
      }
      if (data.apiToken) {
        setDisplayToken(data.apiToken);
        setCustomToken("");
        setFeedback({ type: "ok", text: "API-Token gespeichert. Geräte ggf. neu konfigurieren." });
        router.refresh();
      }
    } catch {
      setFeedback({ type: "err", text: "Netzwerkfehler" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="pt-5 space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Andere Systeme können mit dem API-Token auf Ressourcen und Geräte zugreifen. Token hier setzen oder neu generieren – wird in der Datenbank gespeichert.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-500">Base-URL</span>
            <div className="flex items-center gap-1 min-w-0">
              <code className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded truncate max-w-[240px]">
                {baseUrl}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => copy(baseUrl, "url")}
              >
                {copied === "url" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-500">API-Token</span>
            <div className="flex items-center gap-1 min-w-0">
              <Badge variant="outline" className="font-mono text-xs max-w-[180px] truncate">
                {displayToken || "—"}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => copy(displayToken, "token")}
                disabled={!displayToken}
              >
                {copied === "token" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8"
              disabled={busy}
              onClick={() => patchToken({ regenerate: true })}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Neu generieren</span>
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-api-token" className="text-xs">
              Eigenen Token speichern (min. 16 Zeichen)
            </Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="custom-api-token"
                className="font-mono text-xs h-9"
                placeholder="Neuer Token …"
                value={customToken}
                onChange={(e) => setCustomToken(e.target.value)}
                autoComplete="off"
              />
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0"
                disabled={busy || customToken.trim().length < 16}
                onClick={() => patchToken({ apiToken: customToken.trim() })}
              >
                <Save className="h-3.5 w-3.5" />
                <span className="ml-1.5">Speichern</span>
              </Button>
            </div>
          </div>
          {feedback && (
            <p
              className={
                feedback.type === "ok"
                  ? "text-xs text-emerald-600 dark:text-emerald-400"
                  : "text-xs text-rose-600 dark:text-rose-400"
              }
            >
              {feedback.text}
            </p>
          )}
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Authentifizierung</p>
          <p className="text-xs text-slate-500 dark:text-slate-500">
            Header: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">Authorization: Bearer {'<token>'}</code>
            {" "}oder Query: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">?token={'<token>'}</code>
          </p>
          <p className="text-xs text-slate-500">
            Token ändern (eingeloggt): <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">PATCH /api/settings/account</code> mit{" "}
            <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-[10px]">{`{ "regenerate": true }`}</code> oder{" "}
            <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-[10px]">{`{ "apiToken": "…" }`}</code>
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Endpunkte (Lesen & Geräte steuern)</p>
          <ul className="space-y-1.5 text-xs">
            {ENDPOINTS.map((ep) => (
              <li key={ep.path} className="flex flex-wrap items-baseline gap-2">
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {ep.method}
                </Badge>
                <code className="text-slate-600 dark:text-slate-400">{ep.path}</code>
                <span className="text-slate-500 dark:text-slate-500">– {ep.desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-400">
            Beispiel Gerät öffnen: <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">POST {baseUrl}/api/devices/1/action</code> mit Body <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">{`{"action": "open"}`}</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
