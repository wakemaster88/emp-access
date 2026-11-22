"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { ToggleChip, ToggleChipGroup } from "@/components/ui/toggle-chip";

interface Option {
  id: number;
  name: string;
}

/**
 * Beach Pass: dieselbe Kunden-App für Strandbad-Kunden. Wer nur ein hier
 * gewähltes Abo hat, sieht den Beach Pass (eigene Farbe, Besuchstage am
 * Strandbad-Eingang statt Starts, ohne Lift-Teile). Ab Werk aus.
 */
export function BeachPassCard({
  initial,
  subscriptions,
  rideSubscriptionIds,
  entrances,
}: {
  initial: { enabled: boolean; subscriptionIds: number[] };
  subscriptions: Option[];
  /** Abos des Ride Pass: hier nicht wählbar. */
  rideSubscriptionIds: number[];
  /** Eingangs-Drehkreuze des Strandbads (nur zur Anzeige). */
  entrances: string[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [ids, setIds] = useState(initial.subscriptionIds);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const options = subscriptions.filter((s) => !rideSubscriptionIds.includes(s.id));
  const dirty = enabled !== saved.enabled || [...ids].sort().join(",") !== [...saved.subscriptionIds].sort().join(",");
  const valid = !enabled || ids.length > 0;

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/gamification/beach-pass", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, subscriptionIds: ids }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, text: typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen" });
        return;
      }
      setSaved({ enabled, subscriptionIds: ids });
      const r = json.recount as { year: number; days: number; tickets: number } | null;
      setNotice({
        ok: true,
        text: r
          ? `Gespeichert. ${r.year} neu gezählt: ${r.days.toLocaleString("de-DE")} Besuchstage von ${r.tickets.toLocaleString("de-DE")} Tickets.`
          : "Gespeichert.",
      });
      router.refresh();
    } catch {
      setNotice({ ok: false, text: "Netzwerkfehler" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-primary shrink-0" />
          Beach Pass
        </CardTitle>
        <CardDescription>
          Die Kunden-App für Strandbad-Kunden. Wer nur ein Strandbad-Abo hat, sieht den Beach Pass: eigene Farbe, Besuchstage
          am Strandbad-Eingang statt Starts, ohne Lift-Auslastung und Playlist. Awards, Challenges und Angebote gelten je
          nach Auswahl „Für“ beim Anlegen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="beach-pass-enabled">Beach Pass aktiv</Label>
            <p className="text-xs text-muted-foreground">Aus: Strandbad-Kunden sehen den Ride Pass ohne Zählung.</p>
          </div>
          <Switch
            id="beach-pass-enabled"
            checked={enabled}
            onCheckedChange={(v) => {
              setEnabled(v);
              setNotice(null);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label id="beach-pass-subs">Strandbad-Abos</Label>
          <p className="text-xs text-muted-foreground">Abos des Ride Pass stehen hier nicht: wer am Lift fährt, behält den Ride Pass.</p>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine weiteren Abos angelegt.</p>
          ) : (
            <ToggleChipGroup aria-labelledby="beach-pass-subs">
              {options.map((o) => (
                <ToggleChip
                  key={o.id}
                  pressed={ids.includes(o.id)}
                  onPressedChange={(on) => {
                    setIds((cur) => (on ? [...new Set([...cur, o.id])] : cur.filter((x) => x !== o.id)));
                    setNotice(null);
                  }}
                  className="max-w-full"
                >
                  <span className="truncate">{o.name}</span>
                </ToggleChip>
              ))}
            </ToggleChipGroup>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {entrances.length > 0
            ? `Ein Besuchstag zählt beim Eintritt an: ${entrances.join(", ")}.`
            : "Kein Strandbad-Eingang gefunden: es braucht einen Bereich „Strandbad“ mit Drehkreuz am Eingang."}{" "}
          Beim Speichern wird die laufende Saison neu gezählt.
        </p>
        {!valid && <Notice tone="info" compact title="Bitte mindestens ein Strandbad-Abo wählen." />}
        {notice && <Notice tone={notice.ok ? "success" : "danger"} compact title={notice.text} />}
        <Button onClick={() => void save()} disabled={busy || !dirty || !valid}>
          {busy ? "Speichern …" : "Speichern"}
        </Button>
      </CardContent>
    </Card>
  );
}
