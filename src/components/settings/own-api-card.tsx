"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check, Info } from "lucide-react";

interface OwnApiCardProps {
  baseUrl: string;
  apiToken: string;
}

const ENDPOINTS = [
  { method: "GET", path: "/api/areas", desc: "Ressourcen (Zugangsbereiche) auflisten" },
  { method: "GET", path: "/api/devices", desc: "Geräte auflisten" },
  { method: "GET", path: "/api/devices/[id]", desc: "Einzelnes Gerät abrufen" },
  { method: "POST", path: "/api/devices/[id]/action", desc: "Gerät steuern (action: open, emergency, reset, deactivate)" },
];

export function OwnApiCard({ baseUrl, apiToken }: OwnApiCardProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="pt-5 space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Andere Systeme können mit dem API-Token auf Ressourcen und Geräte zugreifen.
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
                {apiToken || "—"}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => copy(apiToken, "token")}
              >
                {copied === "token" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Authentifizierung</p>
          <p className="text-xs text-slate-500 dark:text-slate-500">
            Header: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">Authorization: Bearer {'<token>'}</code>
            {" "}oder Query: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">?token={'<token>'}</code>
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
