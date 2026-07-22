"use client";

import { useEffect, useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { Settings } from "@/lib/types";
import { Copy, Globe, Loader2, Webhook } from "lucide-react";

type EmpAccessConfig = Settings["empAccess"];

interface EmpAccessSectionProps {
  value: EmpAccessConfig;
  onChange: (next: EmpAccessConfig) => void;
}

export function EmpAccessSection({ value, onChange }: EmpAccessSectionProps) {
  const [testing, setTesting] = useState(false);
  const [origin, setOrigin] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const webhookUrl = origin
    ? `${origin}/api/emp-access/webhook`
    : "/api/emp-access/webhook";
  const webhookConfigured = value.webhookSecret === "***";

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} kopiert`, "success");
    } catch {
      toast("Konnte Clipboard nicht beschreiben", "error");
    }
  }

  function update<K extends keyof EmpAccessConfig>(key: K, v: EmpAccessConfig[K]) {
    onChange({ ...value, [key]: v });
  }

  async function runTest() {
    setTesting(true);
    try {
      const r = await fetch("/api/emp-access/test", { method: "POST" });
      const j = (await r.json()) as {
        ok: boolean;
        error?: string;
        deviceCount?: number;
        baseUrl?: string;
      };
      if (j.ok) {
        toast(
          `emp-access ok — ${j.deviceCount ?? "?"} Geräte (${j.baseUrl ?? ""})`,
          "success",
        );
      } else {
        toast(j.error ?? "Verbindung fehlgeschlagen", "error");
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4 opacity-80" />
            emp-access.de
          </CardTitle>
          <CardDescription>
            API-Token aus dem emp-access-Konto. Damit kann das Dashboard
            Gerätestatus pollen; pro Kamera wählst du dort die Geräte-IDs für
            gültigen/ungültigen Zugang.
          </CardDescription>
        </div>
      </CardHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Aktiv">
          <div className="flex h-10 items-center">
            <Switch checked={value.enabled} onChange={(v) => update("enabled", v)} />
          </div>
        </Field>
        <Field
          label="Abfrage alle N Sekunden"
          hint="3–600. Für Live am Drehkreuz: 3–5 s. Niedrig = mehr API-Last bei emp-access."
        >
          <Input
            type="number"
            min={3}
            max={600}
            value={value.pollIntervalSec}
            onChange={(e) => update("pollIntervalSec", Number(e.target.value))}
          />
        </Field>
        <Field label="Basis-URL" hint="Standard: https://emp-access.de">
          <Input
            value={value.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder="https://emp-access.de"
          />
        </Field>
        <Field
          label="API-Token"
          hint="Bearer-Token; wird maskiert ausgeliefert — leer lassen zum Beibehalten"
        >
          <Input
            type="password"
            autoComplete="off"
            value={value.apiToken === "***" ? "" : value.apiToken}
            onChange={(e) => update("apiToken", e.target.value)}
            placeholder={value.apiToken === "***" ? "(gesetzt)" : ""}
          />
        </Field>
        <div className="flex items-end sm:col-span-2">
          <Button
            type="button"
            variant="secondary"
            onClick={runTest}
            disabled={
              testing ||
              (!value.apiToken?.trim() && value.apiToken !== "***")
            }
            className="gap-2"
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Verbindung testen (/api/devices)
          </Button>
        </div>

        <div className="sm:col-span-2 rounded-lg bg-tile-accent/50 p-3 ring-1 ring-border">
          <div className="mb-2 flex items-center gap-2">
            <Webhook className="size-4 opacity-70" />
            <span className="text-sm font-medium">
              Live-Push vom Drehkreuz (optional)
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-foreground/55">
            Falls emp-access (oder ein eigenes Skript am Drehkreuz) bei jedem
            Scan einen HTTP-POST schicken kann, erscheint der Event{" "}
            <b>sofort</b> in der App — ohne auf den nächsten Poll-Tick zu
            warten. Sobald du das Secret unten erzeugst, ist der Endpoint scharf.
          </p>
          <Field label="Webhook-URL">
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copyText(webhookUrl, "URL")}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </Field>
          <Field
            label="Webhook-Secret"
            hint="Wird in der Config gespeichert. Mit ?secret=… in URL oder Header X-EmpAccess-Webhook-Secret schicken."
          >
            <div className="flex gap-2">
              <Input
                type="text"
                value={value.webhookSecret === "***" ? "(gesetzt)" : value.webhookSecret}
                onChange={(e) => update("webhookSecret", e.target.value)}
                placeholder="leer = bei nächstem Speichern automatisch erzeugen"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const sec =
                    typeof crypto !== "undefined" && crypto.randomUUID
                      ? crypto.randomUUID().replace(/-/g, "")
                      : Math.random().toString(36).slice(2) +
                        Math.random().toString(36).slice(2);
                  update("webhookSecret", sec);
                  toast(
                    "Secret generiert — Einstellungen speichern nicht vergessen",
                    "info",
                  );
                }}
              >
                Neu
              </Button>
            </div>
          </Field>
          {webhookConfigured && (
            <p className="mt-2 text-xs text-emerald-700/90 dark:text-emerald-400/90">
              Webhook ist aktiv — Pushes mit gültigem Secret erscheinen sofort
              auf den Kacheln.
            </p>
          )}
          <details className="mt-3 text-xs text-foreground/55">
            <summary className="cursor-pointer select-none">
              Beispiel-Body und curl
            </summary>
            <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] leading-snug">
{`curl -X POST "${webhookUrl}?secret=DEIN_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceId": 1,
    "kind": "valid",
    "summary": "Scan OK · Karte 12345",
    "detail": "Drehkreuz Eingang"
  }'`}
            </pre>
            <p className="mt-2">
              <code>kind</code> = <code>valid</code> | <code>invalid</code> |{" "}
              <code>info</code>. Fehlt es, schätzt der Server anhand der Felder
              (granted/status/…).
            </p>
          </details>
        </div>
      </div>
    </Card>
  );
}
