"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { SettingsSchema, type Settings, type TelegramConfig } from "@/lib/types";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { TelegramSection } from "@/components/admin/telegram-section";
import { EmpAccessSection } from "@/components/admin/emp-access-section";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [go2rtcStatus, setGo2rtcStatus] = useState<{
    reachable: boolean;
    streams?: string[];
    error?: string;
  } | null>(null);
  const { toast } = useToast();

  async function refresh() {
    const r = await fetch("/api/settings", { cache: "no-store" });
    setSettings(await r.json());
    checkGo2rtc();
  }

  async function checkGo2rtc() {
    try {
      const r = await fetch("/api/go2rtc/reload", { cache: "no-store" });
      setGo2rtcStatus(await r.json());
    } catch (e) {
      setGo2rtcStatus({ reachable: false, error: (e as Error).message });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (!settings) return <p className="text-foreground/60">Lade…</p>;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  async function save() {
    if (!settings) return;
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success) {
      toast("Validierung fehlgeschlagen", "error");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (r.ok) {
        toast("Einstellungen gespeichert", "success");
        refresh();
      } else {
        toast("Speichern fehlgeschlagen", "error");
      }
    } finally {
      setSaving(false);
    }
  }

  async function reloadGo2rtc() {
    setReloading(true);
    try {
      const r = await fetch("/api/go2rtc/reload", { method: "POST" });
      const json = await r.json();
      if (json.ok) {
        toast(
          json.reloaded ? "go2rtc neu geladen" : "yaml geschrieben (go2rtc nicht erreichbar)",
          json.reloaded ? "success" : "info",
        );
        checkGo2rtc();
      } else {
        toast("Reload fehlgeschlagen", "error");
      }
    } finally {
      setReloading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Einstellungen"
        description="Globale Einstellungen für Dashboard, go2rtc und Sicherheits-Schwellen."
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>go2rtc</CardTitle>
            <CardDescription>
              Bridge zwischen RTSP-Cams und WebRTC im Browser. Standard: lokal auf Port 1984.
            </CardDescription>
          </div>
          {go2rtcStatus &&
            (go2rtcStatus.reachable ? (
              <Badge variant="success">
                <CheckCircle2 className="size-3" />
                erreichbar · {go2rtcStatus.streams?.length ?? 0} Streams
              </Badge>
            ) : (
              <Badge variant="danger">
                <XCircle className="size-3" />
                nicht erreichbar
              </Badge>
            ))}
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="go2rtc-URL" hint="z. B. http://127.0.0.1:1984">
            <Input
              value={settings.go2rtcUrl}
              onChange={(e) => update("go2rtcUrl", e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={reloadGo2rtc} disabled={reloading}>
              <RefreshCw className={reloading ? "size-4 animate-spin" : "size-4"} />
              {reloading ? "Lädt…" : "yaml schreiben & reloaden"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Auto-Rotate</CardTitle>
            <CardDescription>
              Wechselt im Fokus-Modus automatisch zwischen Kameras (in Phase 3+ nutzbar).
            </CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Aktiv">
            <div className="flex h-10 items-center">
              <Switch
                checked={settings.autoRotate.enabled}
                onChange={(v) =>
                  update("autoRotate", { ...settings.autoRotate, enabled: v })
                }
              />
            </div>
          </Field>
          <Field label="Intervall (Sekunden)">
            <Input
              type="number"
              value={settings.autoRotate.intervalSec}
              onChange={(e) =>
                update("autoRotate", {
                  ...settings.autoRotate,
                  intervalSec: Number(e.target.value),
                })
              }
            />
          </Field>
          <Field label="Reihenfolge">
            <Select
              value={settings.autoRotate.order}
              onChange={(e) =>
                update("autoRotate", {
                  ...settings.autoRotate,
                  order: e.target.value as "sequential" | "random",
                })
              }
            >
              <option value="sequential">sequenziell</option>
              <option value="random">zufällig</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sicherheit</CardTitle>
            <CardDescription>
              Schutz vor Fehlbedienung der Sirene und Admin-Zugriff.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Admin-PIN"
            hint="4–8 Stellen. Leer = kein Schutz. Wird in Phase 3+ erzwungen."
          >
            <Input
              type="password"
              value={settings.adminPin === "***" ? "" : settings.adminPin}
              onChange={(e) => update("adminPin", e.target.value)}
              placeholder={settings.adminPin === "***" ? "(gesetzt)" : ""}
            />
          </Field>
          <Field label="Dashboard-Reload (Minuten)" hint="0 = aus">
            <Input
              type="number"
              value={settings.reloadIntervalMin}
              onChange={(e) => update("reloadIntervalMin", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Stream-Refresh (Minuten)"
            hint="WebRTC periodisch neu verbinden. 0 = aus, empfohlen 30–120."
          >
            <Input
              type="number"
              min={0}
              max={1440}
              value={settings.streamRefreshMin}
              onChange={(e) => update("streamRefreshMin", Number(e.target.value))}
            />
          </Field>
          <Field label="Sirene Cooldown (Sekunden)">
            <Input
              type="number"
              value={settings.sirenCooldownSec}
              onChange={(e) => update("sirenCooldownSec", Number(e.target.value))}
            />
          </Field>
          <Field label="Sirene max. Dauer (Sekunden)">
            <Input
              type="number"
              value={settings.sirenMaxDurationSec}
              onChange={(e) => update("sirenMaxDurationSec", Number(e.target.value))}
            />
          </Field>
        </div>
      </Card>

      <TelegramSection
        value={settings.telegram}
        onChange={(next: TelegramConfig) => update("telegram", next)}
        onPersistedChange={refresh}
      />

      <EmpAccessSection
        value={settings.empAccess}
        onChange={(next) => update("empAccess", next)}
      />

      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Speichere…" : "Einstellungen speichern"}
        </Button>
      </div>
    </div>
  );
}
