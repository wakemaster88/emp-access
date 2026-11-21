"use client";

import { useState } from "react";
import { Umbrella } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { BEACH_LABEL, DEFAULT_BEACH_SETTINGS, type BeachSettings } from "@/lib/beach-occupancy-labels";

/**
 * Grenzen für „Strandbad jetzt“: geschätzte Gäste vor Ort = Eintritte der
 * letzten 3 Stunden × Faktor. Gilt für Kunden-App und Dashboard.
 */
export function BeachSettingsCard({ initial, capacity }: { initial: BeachSettings; capacity: number | null }) {
  const [saved, setSaved] = useState(initial);
  const [factor, setFactor] = useState(String(initial.factor).replace(".", ","));
  const [medium, setMedium] = useState(String(initial.mediumFrom));
  const [high, setHigh] = useState(String(initial.highFrom));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const f = Number(factor.replace(",", "."));
  const m = Number(medium);
  const h = Number(high);
  const valid = Number.isFinite(f) && f >= 1 && f <= 20 && Number.isInteger(m) && Number.isInteger(h) && m >= 1 && h > m;
  const dirty = f !== saved.factor || m !== saved.mediumFrom || h !== saved.highFrom;
  const pct = (n: number) => (capacity && capacity > 0 ? ` (${Math.round((n / capacity) * 100)} % von ${capacity.toLocaleString("de-DE")})` : "");

  async function save() {
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const res = await fetch("/api/gamification/occupancy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beach: { factor: f, mediumFrom: m, highFrom: h } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      setSaved(json.beach as BeachSettings);
      setDone(true);
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  function edit(set: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => { set(e.target.value); setDone(false); };
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Umbrella className="h-4 w-4 text-primary shrink-0" />
          Auslastung Strandbad
        </CardTitle>
        <CardDescription>
          Die Drehkreuze sehen nur einen Teil der Gäste, die Tageskasse geht nicht darüber. Geschätzt wird: Eintritte der
          letzten 3 Stunden × Faktor. Die Karte erscheint in der App nur an Tagen mit Eintritten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="beach-factor">Faktor</Label>
            <Input id="beach-factor" inputMode="decimal" value={factor} onChange={edit(setFactor)} />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="beach-medium">„{BEACH_LABEL.medium}“ ab Gästen</Label>
            <Input id="beach-medium" type="number" inputMode="numeric" min={1} value={medium} onChange={edit(setMedium)} />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="beach-high">„{BEACH_LABEL.high}“ ab Gästen</Label>
            <Input id="beach-high" type="number" inputMode="numeric" min={2} value={high} onChange={edit(setHigh)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {valid
            ? `${BEACH_LABEL.low}: unter ${m.toLocaleString("de-DE")} · ${BEACH_LABEL.medium}: ab ${m.toLocaleString("de-DE")}${pct(m)} · ${BEACH_LABEL.high}: ab ${h.toLocaleString("de-DE")}${pct(h)}.`
            : "Faktor zwischen 1 und 20, „Viel los“ größer als „Gut besucht“."}{" "}
          Vorgabe Faktor {DEFAULT_BEACH_SETTINGS.factor}, {DEFAULT_BEACH_SETTINGS.mediumFrom} / {DEFAULT_BEACH_SETTINGS.highFrom.toLocaleString("de-DE")}.
        </p>
        {error && <Notice tone="danger" compact title={error} />}
        {done && !dirty && <Notice tone="success" compact title="Gespeichert. Gilt ab sofort in App und Dashboard." />}
        <Button onClick={() => void save()} disabled={busy || !valid || !dirty}>
          Speichern
        </Button>
      </CardContent>
    </Card>
  );
}
