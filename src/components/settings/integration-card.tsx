"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Circle, Trash2, Save, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

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

const PROVIDER_META: Record<string, ProviderMeta> = {
  ANNY: {
    label: "anny.co",
    description: "Ticketing & Event-Management Plattform",
    color: "bg-violet-500",
    fields: {
      token: "API Token",
      eventId: "Event-ID",
      baseUrl: "Base URL (optional)",
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
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const isConfigured = !!initialData?.token;

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
                {new Date(initialData.lastUpdate).toLocaleDateString("de-DE")}
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
                  type="url"
                  placeholder="https://api.example.com"
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
                  placeholder='{"key": "value"}'
                  value={data.extraConfig ?? ""}
                  onChange={(e) => setData({ ...data, extraConfig: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                {error}
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
          </CardContent>
        </>
      )}
    </Card>
  );
}
