"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  WidgetSchema,
  type Widget,
  type Cam,
} from "@/lib/types";
import { useToast } from "@/components/ui/toast";

interface WidgetFormProps {
  initial?: Widget;
  cams: Cam[];
  onSaved: (widget: Widget) => void;
  onCancel: () => void;
}

const TYPES = [
  { value: "reolink", label: "Reolink-Kamera" },
  { value: "doorbird", label: "Doorbird-Klingel" },
  { value: "iframe", label: "iFrame (URL)" },
  { value: "image-refresh", label: "Bild mit Auto-Refresh" },
  { value: "clock", label: "Uhr / Datum" },
  { value: "scans", label: "Scan-Monitor (emp-access)" },
  { value: "tailgate", label: "Drehkreuz-Kontrolle" },
  { value: "services", label: "Dienste-Status" },
] as const;

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function defaultsForType(type: Widget["type"], cams: Cam[]): Widget {
  const base = {
    id: "",
    title: "",
    enabled: true,
    showTitleBar: true,
  };
  switch (type) {
    case "reolink":
      return { ...base, type, camId: cams[0]?.id ?? "" } as Widget;
    case "iframe":
      return {
        ...base,
        type,
        url: "https://",
        zoom: 1,
        sandbox: "allow-scripts allow-same-origin allow-forms",
        reloadMin: 60,
        proxy: false,
      } as Widget;
    case "image-refresh":
      return { ...base, type, url: "https://", intervalMs: 2000 } as Widget;
    case "clock":
      return {
        ...base,
        type,
        format: "24h",
        showSeconds: false,
        showDate: true,
        showTitleBar: false,
      } as Widget;
    case "doorbird":
      return {
        ...base,
        type,
        snapshotIntervalMs: 3000,
      } as Widget;
    case "scans":
      return {
        ...base,
        type,
        limit: 12,
        deviceIds: [],
        intervalMs: 3000,
        deniedOnly: false,
      } as Widget;
    case "tailgate":
      return {
        ...base,
        type,
        camId: cams.find((c) => c.tailgate.enabled)?.id ?? "",
        intervalMs: 10000,
      } as Widget;
    case "services":
      return {
        ...base,
        type,
        title: "Dienste",
        intervalMs: 5000,
      } as Widget;
  }
}

/** „49, 51 53" → [49, 51, 53]. Tippfehler fliegen still raus. */
function parseIds(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[,\s]+/)) {
    const n = Number.parseInt(part, 10);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

export function WidgetForm({ initial, cams, onSaved, onCancel }: WidgetFormProps) {
  const editing = !!initial;
  const [type, setType] = useState<Widget["type"]>(initial?.type ?? "reolink");
  const [data, setData] = useState<Widget>(initial ?? defaultsForType(type, cams));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [autoId, setAutoId] = useState(!editing);
  const { toast } = useToast();

  useEffect(() => {
    if (autoId && data.title) {
      const id = `w-${slugify(data.title)}`;
      if (id !== data.id) setData((d) => ({ ...d, id }));
    }
  }, [data.title, autoId, data.id]);

  function update(key: string, value: unknown) {
    setData((d) => ({ ...d, [key]: value } as Widget));
  }

  function changeType(newType: Widget["type"]) {
    setType(newType);
    const next = defaultsForType(newType, cams);
    setData({ ...next, id: data.id, title: data.title, enabled: data.enabled });
  }

  async function save() {
    setErrors({});
    const parsed = WidgetSchema.safeParse(data);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errs[issue.path.join(".")] = issue.message;
      }
      setErrors(errs);
      toast("Bitte Pflichtfelder prüfen", "error");
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/widgets/${initial!.id}` : "/api/widgets";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await r.json();
      if (!r.ok) {
        toast(json.error ?? "Speichern fehlgeschlagen", "error");
        return;
      }
      toast(editing ? "Widget aktualisiert" : "Widget angelegt", "success");
      onSaved(json.widget ?? parsed.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Typ">
        <Select
          value={type}
          onChange={(e) => changeType(e.target.value as Widget["type"])}
          disabled={editing}
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Titel" error={errors.title}>
        <Input value={data.title} onChange={(e) => update("title", e.target.value)} autoFocus />
      </Field>

      <Field label="ID" error={errors.id}>
        <Input
          value={data.id}
          onChange={(e) => {
            update("id", e.target.value);
            setAutoId(false);
          }}
          disabled={editing}
        />
      </Field>

      <Field label="Aktiv">
        <div className="flex h-10 items-center gap-4">
          <Switch checked={data.enabled} onChange={(v) => update("enabled", v)} />
          <span className="text-sm text-foreground/60">
            Titelleiste:
          </span>
          <Switch
            checked={data.showTitleBar}
            onChange={(v) => update("showTitleBar", v)}
          />
        </div>
      </Field>

      {data.type === "reolink" && (
        <Field label="Kamera" error={errors.camId} className="sm:col-span-2">
          <Select value={data.camId} onChange={(e) => update("camId", e.target.value)}>
            <option value="">– bitte wählen –</option>
            {cams.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.model})
              </option>
            ))}
          </Select>
        </Field>
      )}

      {data.type === "iframe" && (
        <>
          <Field label="URL" error={errors.url} className="sm:col-span-2">
            <Input value={data.url} onChange={(e) => update("url", e.target.value)} />
          </Field>
          <Field label="Zoom (1 = 100 %)">
            <Input
              type="number"
              step="0.05"
              value={data.zoom}
              onChange={(e) => update("zoom", Number(e.target.value))}
            />
          </Field>
          <Field label="Auto-Reload (Minuten)" hint="0 = aus">
            <Input
              type="number"
              value={data.reloadMin ?? 0}
              onChange={(e) => update("reloadMin", Number(e.target.value))}
            />
          </Field>
          <Field label="Sandbox-Flags" className="sm:col-span-2">
            <Textarea
              value={data.sandbox}
              onChange={(e) => update("sandbox", e.target.value)}
            />
          </Field>
          <Field
            label="Server-Proxy"
            hint="Aktivieren wenn die Seite X-Frame-Options/CSP setzt und sich nicht direkt einbetten lässt."
            className="sm:col-span-2"
          >
            <div className="flex h-10 items-center gap-3">
              <Switch checked={data.proxy} onChange={(v) => update("proxy", v)} />
              <span className="text-sm text-foreground/60">
                {data.proxy ? "Aktiv (über /api/embed)" : "Aus"}
              </span>
            </div>
          </Field>
        </>
      )}

      {data.type === "image-refresh" && (
        <>
          <Field label="Bild-URL" error={errors.url} className="sm:col-span-2">
            <Input value={data.url} onChange={(e) => update("url", e.target.value)} />
          </Field>
          <Field label="Intervall (ms)">
            <Input
              type="number"
              value={data.intervalMs}
              onChange={(e) => update("intervalMs", Number(e.target.value))}
            />
          </Field>
        </>
      )}

      {data.type === "clock" && (
        <>
          <Field label="Format">
            <Select value={data.format} onChange={(e) => update("format", e.target.value as "24h" | "12h")}>
              <option value="24h">24-Stunden</option>
              <option value="12h">12-Stunden (am/pm)</option>
            </Select>
          </Field>
          <Field label="Optionen">
            <div className="flex h-10 items-center gap-4">
              <span className="text-sm text-foreground/60">Sek.:</span>
              <Switch checked={data.showSeconds} onChange={(v) => update("showSeconds", v)} />
              <span className="text-sm text-foreground/60">Datum:</span>
              <Switch checked={data.showDate} onChange={(v) => update("showDate", v)} />
            </div>
          </Field>
        </>
      )}

      {data.type === "doorbird" && (
        <Field
          label="Snapshot-Intervall (ms)"
          hint="Im Grid wird der Doorbird als Standbild angezeigt. Im Focus läuft Live-WebRTC."
          className="sm:col-span-2"
        >
          <Input
            type="number"
            min={500}
            max={60000}
            step={500}
            value={data.snapshotIntervalMs}
            onChange={(e) => update("snapshotIntervalMs", Number(e.target.value))}
          />
        </Field>
      )}

      {data.type === "scans" && (
        <>
          <Field label="Anzahl Scans" hint="3 bis 50">
            <Input
              type="number"
              min={3}
              max={50}
              value={data.limit}
              onChange={(e) => update("limit", Number(e.target.value))}
            />
          </Field>
          <Field label="Aktualisierung (ms)">
            <Input
              type="number"
              min={1000}
              max={60000}
              step={500}
              value={data.intervalMs}
              onChange={(e) => update("intervalMs", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Geräte-IDs"
            hint="Leer = alle Geräte. Mehrere durch Komma trennen."
            className="sm:col-span-2"
          >
            <Input
              value={data.deviceIds.join(", ")}
              onChange={(e) => update("deviceIds", parseIds(e.target.value))}
              placeholder="z. B. 49, 51, 53"
            />
          </Field>
          <Field label="Nur Abgelehnte" className="sm:col-span-2">
            <div className="flex h-10 items-center gap-3">
              <Switch
                checked={data.deniedOnly}
                onChange={(v) => update("deniedOnly", v)}
              />
              <span className="text-sm text-foreground/60">
                {data.deniedOnly
                  ? "Zeigt nur abgelehnte und geschützte Scans"
                  : "Zeigt alle Scans"}
              </span>
            </div>
          </Field>
        </>
      )}

      {data.type === "tailgate" && (
        <>
          <Field
            label="Kamera"
            hint="Nur Kameras mit eingeschalteter Drehkreuz-Kontrolle liefern Werte."
            className="sm:col-span-2"
          >
            <Select value={data.camId} onChange={(e) => update("camId", e.target.value)}>
              <option value="">– erste Kamera mit Kontrolle –</option>
              {cams.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.tailgate.enabled ? "" : " (Kontrolle aus)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aktualisierung (ms)" className="sm:col-span-2">
            <Input
              type="number"
              min={2000}
              max={60000}
              step={1000}
              value={data.intervalMs}
              onChange={(e) => update("intervalMs", Number(e.target.value))}
            />
          </Field>
        </>
      )}

      {data.type === "services" && (
        <Field
          label="Aktualisierung (ms)"
          hint="Hub, Tracker, go2rtc, Cloud, Doorbird und Face."
          className="sm:col-span-2"
        >
          <Input
            type="number"
            min={2000}
            max={60000}
            step={1000}
            value={data.intervalMs}
            onChange={(e) => update("intervalMs", Number(e.target.value))}
          />
        </Field>
      )}

      <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Speichere…" : editing ? "Speichern" : "Anlegen"}
        </Button>
      </div>
    </div>
  );
}
