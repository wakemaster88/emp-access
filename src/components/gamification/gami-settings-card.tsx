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
  initial: {
    enabled: boolean; subscriptionIds: number[]; startCapPerDay: number; startDeviceIds: number[];
    dayServiceIds: number[];
    /** Preise in Cent, Schlüssel ist die ID als Text. */
    servicePrices: Record<string, number>;
    subscriptionPrices: Record<string, number>;
  };
  subscriptions: Option[];
  services: Option[];
  devices: Option[];
  year: number;
}

function toggle(list: number[], id: number, on: boolean): number[] {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

/** Cent als Eingabetext in Euro, z. B. 2450 → "24,50". */
function euroText(prices: Record<string, number>): Record<string, string> {
  return Object.fromEntries(Object.entries(prices).map(([id, cents]) => [id, (cents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "")]));
}

/** Eingabetext in Cent; null bei leer, undefined bei ungültig. */
function euroCents(text: string | undefined): number | null | undefined {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(t)) return undefined;
  const cents = Math.round(Number(t.replace(",", ".")) * 100);
  return cents > 0 ? cents : undefined;
}

function toCents(texts: Record<string, string>, ids: number[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const cents = euroCents(texts[String(id)]);
    if (cents === undefined) return null;
    if (cents != null) out[String(id)] = cents;
  }
  return out;
}

/** Gamification ein-/ausschalten, teilnehmende Abos und Start-Geräte wählen, Jahr zurückrechnen. */
export function GamiSettingsCard({ initial, subscriptions, services, devices, year }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    ...initial,
    startCapPerDay: String(initial.startCapPerDay),
    servicePrices: euroText(initial.servicePrices),
    subscriptionPrices: euroText(initial.subscriptionPrices),
  });
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const cap = Number(form.startCapPerDay);
  const servicePrices = toCents(form.servicePrices, form.dayServiceIds);
  const subscriptionPrices = toCents(form.subscriptionPrices, form.subscriptionIds);
  const valid = Number.isInteger(cap) && cap >= 1 && cap <= 100 && servicePrices != null && subscriptionPrices != null;

  async function save() {
    if (!valid) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/gamification/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, startCapPerDay: cap, servicePrices, subscriptionPrices }),
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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Tagestickets in der App</legend>
            <p className="text-xs text-muted-foreground">
              Gäste mit diesen Tickets können die App nutzen: Sie scannen ihr Ticket selbst oder bekommen im Reiter Fahrer einen QR-Code.
              Jedes angemeldete Ticket zählt als Besuchstag. Mit Preis rechnet die App ab dem dritten Besuch vor, ob sich ein Abo lohnt.
            </p>
            {services.length === 0 && <p className="text-sm text-muted-foreground">Keine Ticket-Typen angelegt.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {services.map((s) => {
                const on = form.dayServiceIds.includes(s.id);
                return (
                  <div key={s.id} className="flex min-h-9 items-center gap-2 max-sm:min-h-11">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) => setForm((f) => ({ ...f, dayServiceIds: toggle(f.dayServiceIds, s.id, v === true) }))}
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                    {on && (
                      <Input
                        aria-label={`Preis ${s.name} in Euro`}
                        placeholder="Preis €"
                        inputMode="decimal"
                        value={form.servicePrices[String(s.id)] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, servicePrices: { ...f.servicePrices, [String(s.id)]: e.target.value } }))}
                        aria-invalid={euroCents(form.servicePrices[String(s.id)]) === undefined}
                        className="w-24 shrink-0 max-sm:h-11"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          {form.subscriptionIds.length > 0 && form.dayServiceIds.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Abo-Preise für den Abo-Rechner</legend>
              <p className="text-xs text-muted-foreground">Ohne Preis erscheint der Abo-Rechner nicht. Verglichen wird mit dem günstigsten Abo.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {subscriptions.filter((s) => form.subscriptionIds.includes(s.id)).map((s) => (
                  <div key={s.id} className="flex min-h-9 items-center gap-2 max-sm:min-h-11">
                    <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                    <Input
                      aria-label={`Preis ${s.name} in Euro`}
                      placeholder="Preis €"
                      inputMode="decimal"
                      value={form.subscriptionPrices[String(s.id)] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, subscriptionPrices: { ...f.subscriptionPrices, [String(s.id)]: e.target.value } }))}
                      aria-invalid={euroCents(form.subscriptionPrices[String(s.id)]) === undefined}
                      className="w-24 shrink-0 max-sm:h-11"
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          )}

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
