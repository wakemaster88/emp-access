"use client";

import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { PushPreview } from "@/components/ui/push-preview";
import { Switch } from "@/components/ui/switch";
import { announceBlockText, type AnnounceBlock, type AnnounceText } from "@/lib/rider-announce-rules";

/** Wie viele Kunden mit Push-Erlaubnis die Meldung erreicht. */
export interface PushReach {
  devices: number;
  riders: number;
}

/** Push-Stand eines Eintrags für die Verwaltung. */
export interface PushStatus {
  /** ISO-Zeit des Versands oder null. */
  pushedAt: string | null;
  pushSent: number | null;
}

function sentText(s: PushStatus): string {
  const at = new Date(s.pushedAt as string).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const n = s.pushSent ?? 0;
  return `Push gesendet am ${at} an ${n} ${n === 1 ? "Gerät" : "Geräte"}.`;
}

function reachText(r: PushReach): string {
  if (r.devices === 0) return "Noch hat kein Kunde Benachrichtigungen eingeschaltet, es würde also niemand erreicht.";
  const k = r.riders === 1 ? "1 Kunde" : `${r.riders} Kunden`;
  const g = r.devices === 1 ? "1 Gerät" : `${r.devices} Geräte`;
  return `Erreicht ${k} auf ${g}. Nur wer in der App Benachrichtigungen eingeschaltet hat, bekommt sie.`;
}

/**
 * Schalter „Push an Kunden senden“ mit Vorschau. Gesendet wird einmal, nicht
 * bei jedem Bearbeiten; `block` sagt, warum der Push (noch) wartet.
 */
export function PushAnnounceField({
  id, checked, onChange, disabled, preview, reach, status, block,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  preview: AnnounceText;
  reach: PushReach;
  status: PushStatus | null;
  /** Grund nach dem Speichern, null = geht sofort raus. */
  block: AnnounceBlock | null;
}) {
  if (status?.pushedAt) {
    return <Notice tone="success" compact title={sentText(status)} />;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor={id}>Push an Kunden senden</Label>
          <p className="text-xs text-muted-foreground">Einmalig, Bearbeiten danach meldet nichts erneut.</p>
        </div>
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </div>
      {checked && (
        <>
          <PushPreview app="Ride Pass" title={preview.title} body={preview.body} />
          <p className="text-xs text-muted-foreground">{reachText(reach)}</p>
          {block && block !== "not-planned" && (
            <Notice tone={block === "test" || block === "over" ? "warning" : "info"} compact title={announceBlockText(block)} />
          )}
        </>
      )}
    </div>
  );
}
