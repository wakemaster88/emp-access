"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  AlprConfigSchema,
  DoorbirdSchema,
  type AlprConfig,
  type DoorbirdConfig,
} from "@/lib/types";
import { Bell, Copy, RotateCcw, PlugZap, Search, Loader2, ImageIcon } from "lucide-react";
import { AlprSection } from "@/components/admin/alpr-section";

function randomSecret(len = 24) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

export default function DoorbirdPage() {
  const [config, setConfig] = useState<DoorbirdConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [origin, setOrigin] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/doorbird", { cache: "no-store" })
      .then((r) => r.json())
      .then(setConfig);
    setOrigin(window.location.origin);
  }, []);

  if (!config) return <p className="text-foreground/60">Lade…</p>;

  function update<K extends keyof DoorbirdConfig>(key: K, value: DoorbirdConfig[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }

  function patchEventSnapshots(
    part: Partial<NonNullable<DoorbirdConfig["eventSnapshots"]>>,
  ) {
    setConfig((c) => {
      if (!c) return c;
      const base = c.eventSnapshots ?? { enabled: true, retentionDays: 90 };
      return { ...c, eventSnapshots: { ...base, ...part } };
    });
  }

  async function save() {
    if (!config) return;
    const parsed = DoorbirdSchema.safeParse(config);
    if (!parsed.success) {
      toast("Validierung fehlgeschlagen", "error");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/doorbird", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (r.ok) {
        toast("Doorbird-Konfiguration gespeichert", "success");
      } else {
        toast("Speichern fehlgeschlagen", "error");
      }
    } finally {
      setSaving(false);
    }
  }

  function ensureSecret() {
    if (!config) return;
    if (!config.webhookSecret || config.webhookSecret === "***") {
      update("webhookSecret", randomSecret());
      toast("Neues Secret generiert", "info");
    }
  }

  async function scanNetwork() {
    setScanning(true);
    try {
      const r = await fetch("/api/doorbird/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) {
        toast(j.error ?? "Scan fehlgeschlagen", "error");
        return;
      }
      const found = j.found as Array<{ ip: string; realm: string }>;
      if (found.length === 0) {
        toast("Kein Doorbird im Netz gefunden", "info");
        return;
      }
      const first = found[0];
      update("ip", first.ip);
      toast(
        found.length === 1
          ? `Doorbird gefunden: ${first.ip} (${first.realm})`
          : `${found.length} Doorbird-Geräte gefunden – erstes übernommen: ${first.ip}`,
        "success",
      );
    } finally {
      setScanning(false);
    }
  }

  const secretForUrl =
    config.webhookSecret && config.webhookSecret !== "***"
      ? config.webhookSecret
      : "DEIN_SECRET";
  const webhookUrl = `${origin}/api/doorbird/ring?secret=${secretForUrl}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Doorbird"
        description="Klingel-Integration. Klingel-Logik und Tür-Öffnen werden in Phase 4 freigeschaltet."
        actions={
          <Badge variant={config.enabled ? "success" : "default"}>
            <Bell className="size-3" />
            {config.enabled ? "aktiv" : "deaktiviert"}
          </Badge>
        }
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Verbindung</CardTitle>
            <CardDescription>
              IP und API-User aus der Doorbird-App. API-User braucht „API-Operator", „Watch", „Listen/Talk", „Open doors".
            </CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Aktiv">
            <div className="flex h-10 items-center">
              <Switch checked={config.enabled} onChange={(v) => update("enabled", v)} />
            </div>
          </Field>
          <Field label="IP-Adresse">
            <div className="flex gap-2">
              <Input
                value={config.ip}
                onChange={(e) => update("ip", e.target.value)}
                placeholder="192.168.1.30"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={scanNetwork}
                disabled={scanning}
                title="Netzwerk nach Doorbird durchsuchen"
              >
                {scanning ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Scannen
              </Button>
            </div>
          </Field>
          <Field label="Benutzername">
            <Input value={config.username} onChange={(e) => update("username", e.target.value)} />
          </Field>
          <Field label="Passwort" hint="Leer = unverändert">
            <Input
              type="password"
              value={config.password === "***" ? "" : config.password}
              onChange={(e) => update("password", e.target.value)}
              placeholder={config.password === "***" ? "(unverändert)" : ""}
            />
          </Field>
          <Field label="Relais (Tür)" hint="Standard: 1">
            <Input value={config.relayId} onChange={(e) => update("relayId", e.target.value)} />
          </Field>
          <Field label="Klingel-Sound (URL, optional)">
            <Input
              value={config.ringSoundUrl}
              onChange={(e) => update("ringSoundUrl", e.target.value)}
              placeholder="/sounds/dingdong.mp3"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Webhook</CardTitle>
            <CardDescription>
              Diese URL trägst du in der Doorbird-App unter „HTTP-Anrufe bei
              Klingelvorgang" ein. Das Secret in der URL schützt vor fremden Auslösungen.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-tile-accent px-3 py-2 font-mono text-xs ring-1 ring-border">
              {webhookUrl}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl);
                toast("URL kopiert", "success");
              }}
            >
              <Copy className="size-3" />
              Kopieren
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Secret" hint="zufällig, mind. 16 Zeichen">
              <Input
                value={config.webhookSecret === "***" ? "(gesetzt)" : config.webhookSecret}
                onChange={(e) => update("webhookSecret", e.target.value)}
              />
            </Field>
            <Field label="Ring-Fenster (Sekunden)" hint="Tür öffnen nur in diesem Fenster nach Klingeln">
              <Input
                type="number"
                value={config.ringWindowSec}
                onChange={(e) => update("ringWindowSec", Number(e.target.value))}
              />
            </Field>
            <Field label="Auto-Hide (Sekunden)" hint="Overlay schließen ohne Aktion">
              <Input
                type="number"
                value={config.autoHideSec}
                onChange={(e) => update("autoHideSec", Number(e.target.value))}
              />
            </Field>
            <Field
              label="Ring-Fenster erzwingen"
              hint="Serverseitig: Tür öffnen nur nach Klingeln (ALPR ausgenommen)"
            >
              <div className="flex h-10 items-center">
                <Switch
                  checked={config.enforceRingWindow}
                  onChange={(v) => update("enforceRingWindow", v)}
                />
              </div>
            </Field>
          </div>
          <div className="flex justify-start">
            <Button variant="ghost" size="sm" onClick={ensureSecret}>
              Neues Secret generieren
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-2">
            <ImageIcon className="mt-0.5 size-5 text-foreground/60" />
            <div>
              <CardTitle>Ereignis-Snapshots</CardTitle>
              <CardDescription>
                Bei jedem <strong>Klingeln</strong> (Webhook akzeptiert) und bei jedem{" "}
                <strong>Tür öffnen</strong> wird ein JPEG von{" "}
                <code className="text-xs">image.cgi</code> unter{" "}
                <code className="truncate text-xs">logs/doorbird-events/</code> abgelegt;
                Liste in <code className="text-xs">events.jsonl</code>.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2 px-6 pb-2">
          <Field label="Lokal speichern">
            <div className="flex h-10 items-center">
              <Switch
                checked={config.eventSnapshots?.enabled ?? true}
                onChange={(v) => patchEventSnapshots({ enabled: v })}
              />
            </div>
          </Field>
          <Field
            label="Aufbewahrung (Tage)"
            hint="0 = alte Schnappschüsse nie automatisch löschen"
          >
            <Input
              type="number"
              min={0}
              max={3650}
              value={config.eventSnapshots?.retentionDays ?? 90}
              onChange={(e) =>
                patchEventSnapshots({ retentionDays: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <p className="text-xs text-foreground/50 px-6 pb-5">
          Telegram nutzt dasselbe Bild wie die Speicherung, es wird nur einmal pro Ereignis von
          der Doorbird geholt.
        </p>
      </Card>

      <AlprSection
        value={config.alpr ?? AlprConfigSchema.parse({})}
        onChange={(next: AlprConfig) => update("alpr", next)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const r = await fetch("/api/doorbird/test?action=info", { method: "POST" });
              const j = await r.json();
              if (j.ok) {
                const ver = j.info?.BHA?.VERSION?.[0];
                toast(
                  `Verbindung ok – ${ver?.["DEVICE-TYPE"] ?? "Doorbird"} · FW ${ver?.FIRMWARE ?? "?"}`,
                  "success",
                );
              } else {
                toast(j.error ?? "Fehler", "error");
              }
            }}
          >
            <PlugZap className="size-4" />
            Verbindung testen
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              const r = await fetch("/api/doorbird/test?action=ring", { method: "POST" });
              const j = await r.json();
              if (j.ok && j.accepted) toast("Test-Klingel ausgelöst", "success");
              else if (j.ok) toast("Klingel ignoriert (Cooldown)", "info");
              else toast(j.error ?? "Fehler", "error");
            }}
          >
            <RotateCcw className="size-4" />
            Test-Klingel
          </Button>
        </div>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Speichere…" : "Speichern"}
        </Button>
      </div>
    </div>
  );
}
