"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
} from "@/lib/data-retention";

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
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-2 text-slate-600 dark:text-slate-300">
            <Trash2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">Löschfristen</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Historien und Logs werden nächtlich automatisch gelöscht. Stammdaten (Fahrzeuge,
              Personen, Kameras, Tickets) bleiben erhalten.
            </p>
          </div>
        </div>

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
                  <SelectTrigger id={`ret-${key}`}>
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
                <p className="text-xs text-slate-500">{meta.description}</p>
              </div>
            );
          })}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-emerald-600">Gespeichert – gilt ab dem nächsten Nacht-Lauf.</p>}

        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Speichern
        </Button>
      </CardContent>
    </Card>
  );
}
