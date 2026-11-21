"use client";

import { useState } from "react";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { DEFAULT_OCCUPANCY_THRESHOLDS, OCCUPANCY_LABEL, type OccupancyThresholds } from "@/lib/rider-occupancy-labels";

/**
 * Grenzen für „Auslastung jetzt“ (Fahrer am Lift in den letzten 60 Minuten).
 * Gelten gleich für die Kunden-App und das Dashboard der Verwaltung.
 */
export function OccupancySettingsCard({ initial }: { initial: OccupancyThresholds }) {
  const [saved, setSaved] = useState(initial);
  const [medium, setMedium] = useState(String(initial.mediumFrom));
  const [high, setHigh] = useState(String(initial.highFrom));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const m = Number(medium);
  const h = Number(high);
  const valid = Number.isInteger(m) && Number.isInteger(h) && m >= 2 && h > m && h <= 500;
  const dirty = m !== saved.mediumFrom || h !== saved.highFrom;

  async function save() {
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const res = await fetch("/api/gamification/occupancy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediumFrom: m, highFrom: h }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      setSaved(json.thresholds as OccupancyThresholds);
      setDone(true);
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary shrink-0" />
          Auslastung am Lift
        </CardTitle>
        <CardDescription>
          Gezählt werden verschiedene Fahrer am Start-Drehkreuz in den letzten 60 Minuten. Die Stufe steht in der
          Kunden-App unter „Auslastung jetzt“ und im Dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="occ-medium">„{OCCUPANCY_LABEL.medium}“ ab</Label>
            <Input
              id="occ-medium"
              type="number"
              inputMode="numeric"
              min={2}
              value={medium}
              onChange={(e) => { setMedium(e.target.value); setDone(false); }}
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="occ-high">„{OCCUPANCY_LABEL.high}“ ab</Label>
            <Input
              id="occ-high"
              type="number"
              inputMode="numeric"
              min={3}
              value={high}
              onChange={(e) => { setHigh(e.target.value); setDone(false); }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {valid
            ? `${OCCUPANCY_LABEL.low}: 1–${m - 1} Fahrer · ${OCCUPANCY_LABEL.medium}: ${m}–${h - 1} · ${OCCUPANCY_LABEL.high}: ab ${h}.`
            : "„Viel los“ muss größer sein als „Gut besucht“."}{" "}
          Vorgabe {DEFAULT_OCCUPANCY_THRESHOLDS.mediumFrom} / {DEFAULT_OCCUPANCY_THRESHOLDS.highFrom}: „Viel los“ erscheint damit
          in rund 5 % der Betriebszeit.
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
