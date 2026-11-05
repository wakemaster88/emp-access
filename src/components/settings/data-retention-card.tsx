"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, Trash2 } from "lucide-react";
import {
  RETENTION_KEYS,
  RETENTION_LABELS,
  RETENTION_DAY_OPTIONS,
  type DataRetentionConfig,
  type RetentionKey,
} from "@/lib/data-retention-config";

interface Props {
  initial: DataRetentionConfig;
}

function optionValue(days: number | null): string {
  return days == null ? "null" : String(days);
}

function parseOption(v: string): number | null {
  if (v === "null") return null;
  return Number(v);
}

export function DataRetentionCard({ initial }: Props) {
  const [form, setForm] = useState<DataRetentionConfig>({ ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const setKey = (key: RetentionKey, value: number | null) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings/retention", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      setForm(json.retention);
      setSaved(true);
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <IconChip icon={Trash2} size="lg" />
          <div className="min-w-0 space-y-1">
            <CardTitle><h3>Löschfristen</h3></CardTitle>
            <CardDescription>
              Historien und Logs werden nächtlich automatisch gelöscht. Stammdaten (Fahrzeuge,
              Personen, Kameras, Tickets) bleiben erhalten.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {RETENTION_KEYS.map((key) => {
            const meta = RETENTION_LABELS[key];
            return (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`ret-${key}`}>{meta.label}</Label>
                <Select
                  value={optionValue(form[key])}
                  onValueChange={(v) => setKey(key, parseOption(v))}
                >
                  <SelectTrigger id={`ret-${key}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETENTION_DAY_OPTIONS.map((opt) => (
                      <SelectItem key={optionValue(opt.value)} value={optionValue(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{meta.description}</p>
              </div>
            );
          })}
        </div>

        {error && <Notice tone="danger" compact title={error} />}
        {saved && <Notice tone="success" compact title="Gespeichert – gilt ab dem nächsten Nacht-Lauf." />}

        <Button onClick={save} disabled={saving} className="gap-1.5 max-sm:h-11 max-sm:w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Speichern
        </Button>
      </CardContent>
    </Card>
  );
}
