"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { History, Loader2, Save, Settings } from "lucide-react";

interface Option {
  id: number;
  name: string;
}

interface Props {
  initial: { enabled: boolean; subscriptionIds: number[]; startCapPerDay: number; startDeviceIds: number[] };
  subscriptions: Option[];
  devices: Option[];
  year: number;
}

function toggle(list: number[], id: number, on: boolean): number[] {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

/** Gamification ein-/ausschalten, teilnehmende Abos und Start-Geräte wählen, Jahr zurückrechnen. */
export function GamiSettingsCard({ initial, subscriptions, devices, year }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ ...initial, startCapPerDay: String(initial.startCapPerDay) });
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const cap = Number(form.startCapPerDay);
  const valid = Number.isInteger(cap) && cap >= 1 && cap <= 100;

  async function save() {
    if (!valid) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/gamification/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, startCapPerDay: cap }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, text: typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen" });
        return;
      }
      setNotice({ ok: true, text: "Gespeichert." });
      router.refresh();
    } catch {
      setNotice({ ok: false, text: "Netzwerkfehler" });
    } finally {
      setSaving(false);
    }
  }

  async function backfill() {
    setBackfilling(true);
    setNotice(null);
    try {
      const res = await fetch("/api/gamification/backfill", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, text: typeof json.error === "string" ? json.error : "Neuberechnung fehlgeschlagen" });
        return;
      }
      setNotice({
        ok: true,
        text: `${json.year} neu berechnet: ${json.scans} Starts an ${json.days} Besuchstagen von ${json.tickets} Fahrern.`,
      });
      router.refresh();
    } catch {
      setNotice({ ok: false, text: "Netzwerkfehler" });
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary shrink-0" />
            Einstellungen
          </CardTitle>
          <CardDescription>
            Solange die Gamification aus ist, wird nichts gezählt und kein Gutschein ausgegeben.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="gami-enabled">Gamification aktiv</Label>
            <Switch id="gami-enabled" checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Teilnehmende Abos</legend>
            {subscriptions.length === 0 && <p className="text-sm text-muted-foreground">Keine Abos angelegt.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {subscriptions.map((s) => (
                <label key={s.id} className="flex min-h-9 items-center gap-2 text-sm max-sm:min-h-11">
                  <Checkbox
                    checked={form.subscriptionIds.includes(s.id)}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, subscriptionIds: toggle(f.subscriptionIds, s.id, v === true) }))}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Start-Geräte</legend>
            <p className="text-xs text-muted-foreground">
              Ein erlaubter Scan eines Abo-Tickets an diesen Geräten zählt als Start, zum Beispiel das Drehkreuz an der Seilbahn.
            </p>
            {devices.length === 0 && <p className="text-sm text-muted-foreground">Keine Scanner angelegt.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {devices.map((d) => (
                <label key={d.id} className="flex min-h-9 items-center gap-2 text-sm max-sm:min-h-11">
                  <Checkbox
                    checked={form.startDeviceIds.includes(d.id)}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, startDeviceIds: toggle(f.startDeviceIds, d.id, v === true) }))}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor="gami-cap">Starts pro Tag, die höchstens zählen</Label>
            <Input id="gami-cap" type="number" min={1} max={100} inputMode="numeric" value={form.startCapPerDay} onChange={(e) => setForm((f) => ({ ...f, startCapPerDay: e.target.value }))} className="max-sm:h-11" />
            <p className="text-xs text-muted-foreground">Gilt für Meilensteine nach Starts. Die Statistik zeigt weiter alle Starts.</p>
          </div>

          {notice && <Notice tone={notice.ok ? "success" : "danger"} compact title={notice.text} />}

          <Button onClick={save} disabled={saving || !valid} className="gap-1.5 max-sm:h-11 max-sm:w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Speichern
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary shrink-0" />
            Statistik {year} neu berechnen
          </CardTitle>
          <CardDescription>
            Baut die Tagessummen des laufenden Jahres aus den gespeicherten Scans neu auf, mit den oben gespeicherten Abos und Start-Geräten.
            Dabei werden keine Meilensteine oder Gutscheine vergeben.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={backfill} disabled={backfilling} className="gap-1.5 max-sm:h-11 max-sm:w-full">
            {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            Neu berechnen
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
