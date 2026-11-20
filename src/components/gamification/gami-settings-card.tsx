"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { ToggleChip, ToggleChipGroup } from "@/components/ui/toggle-chip";
import { Check, History, Loader2, Save, Settings } from "lucide-react";

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

  const dayServices = services.filter((s) => form.dayServiceIds.includes(s.id));
  const priceSubs = subscriptions.filter((s) => form.subscriptionIds.includes(s.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary shrink-0" />
          Zählen und Awards
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="gami-enabled">Gamification aktiv</Label>
            <p className="text-xs text-muted-foreground">Aus: nichts wird gezählt, kein Gutschein ausgegeben.</p>
          </div>
          <Switch id="gami-enabled" checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
        </div>

        <ChipField
          id="gami-subs"
          label="Teilnehmende Abos"
          empty="Keine Abos angelegt."
          options={subscriptions}
          selected={form.subscriptionIds}
          onToggle={(id, on) => setForm((f) => ({ ...f, subscriptionIds: toggle(f.subscriptionIds, id, on) }))}
        />

        <ChipField
          id="gami-devices"
          label="Start-Geräte"
          hint="Ein erlaubter Abo-Scan hier zählt als Start, z. B. am Drehkreuz zur Seilbahn."
          empty="Keine Scanner angelegt."
          options={devices}
          selected={form.startDeviceIds}
          onToggle={(id, on) => setForm((f) => ({ ...f, startDeviceIds: toggle(f.startDeviceIds, id, on) }))}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="gami-cap">Starts pro Tag höchstens</Label>
            <p className="text-xs text-muted-foreground">Gilt für Awards. Die Statistik zählt alle.</p>
          </div>
          <Input
            id="gami-cap"
            type="number"
            min={1}
            max={100}
            inputMode="numeric"
            value={form.startCapPerDay}
            onChange={(e) => setForm((f) => ({ ...f, startCapPerDay: e.target.value }))}
            aria-invalid={!(Number.isInteger(cap) && cap >= 1 && cap <= 100)}
            className="w-20 shrink-0 text-right max-sm:h-11"
          />
        </div>

        <ChipField
          id="gami-day"
          label="Tagestickets in der App"
          hint="Gäste mit diesen Tickets holen sich ihren Link per Mail an die Adresse am Ticket. Jeder Tag mit Ticket zählt als Besuchstag."
          empty="Keine Ticket-Typen angelegt."
          options={services}
          selected={form.dayServiceIds}
          onToggle={(id, on) => setForm((f) => ({ ...f, dayServiceIds: toggle(f.dayServiceIds, id, on) }))}
        />

        {dayServices.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Preise für den Abo-Rechner</legend>
            <p className="text-xs text-muted-foreground">
              Ab dem dritten Besuch rechnet die App vor, ob sich das günstigste Abo lohnt. Ohne Preise erscheint der Rechner nicht.
            </p>
            <div className="divide-y divide-border rounded-lg border border-border">
              {dayServices.map((s) => (
                <PriceRow
                  key={`s${s.id}`}
                  name={s.name}
                  value={form.servicePrices[String(s.id)]}
                  onChange={(v) => setForm((f) => ({ ...f, servicePrices: { ...f.servicePrices, [String(s.id)]: v } }))}
                />
              ))}
              {priceSubs.map((s) => (
                <PriceRow
                  key={`a${s.id}`}
                  name={s.name}
                  value={form.subscriptionPrices[String(s.id)]}
                  onChange={(v) => setForm((f) => ({ ...f, subscriptionPrices: { ...f.subscriptionPrices, [String(s.id)]: v } }))}
                />
              ))}
            </div>
          </fieldset>
        )}

        {notice && <Notice tone={notice.ok ? "success" : "danger"} compact title={notice.text} />}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button onClick={save} disabled={saving || !valid} className="gap-1.5 max-sm:h-11 max-sm:w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Speichern
          </Button>
          <Button
            variant="ghost"
            onClick={backfill}
            disabled={backfilling}
            title={`Baut die Tagessummen ${year} aus den gespeicherten Scans neu auf, mit den gespeicherten Abos und Start-Geräten. Vergibt keine Awards.`}
            className="gap-1.5 text-muted-foreground max-sm:h-11 max-sm:w-full"
          >
            {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            Statistik {year} neu berechnen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Mehrfachauswahl als Chips mit Überschrift und kurzem Hinweis. */
function ChipField({
  id, label, hint, empty, options, selected, onToggle,
}: {
  id: string;
  label: string;
  hint?: string;
  empty: string;
  options: Option[];
  selected: number[];
  onToggle: (id: number, on: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p id={id} className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ToggleChipGroup aria-labelledby={id}>
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <ToggleChip key={o.id} pressed={on} onPressedChange={(v) => onToggle(o.id, v)} className="max-w-full">
                {on && <Check />}
                <span className="truncate">{o.name}</span>
              </ToggleChip>
            );
          })}
        </ToggleChipGroup>
      )}
    </div>
  );
}

/** Eine Zeile „Name … Preis €“ für den Abo-Rechner. */
function PriceRow({ name, value, onChange }: { name: string; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <Input
        aria-label={`Preis ${name} in Euro`}
        placeholder="€"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={euroCents(value) === undefined}
        className="w-24 shrink-0 text-right max-sm:h-11"
      />
    </div>
  );
}
