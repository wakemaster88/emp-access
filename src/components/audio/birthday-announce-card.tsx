"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Cake, Headphones, Loader2, Pencil, Save } from "lucide-react";
import { normalizeTtsVoice, TTS_FALLBACK_VOICES, type TtsVoice } from "@/lib/audio-constants";
import { BIRTHDAY_ANNOUNCE_MAX, BIRTHDAY_DEFAULT_ANNOUNCE, birthdayAnnounceText } from "@/lib/birthday";
import { Chip, TEXTAREA_CLASS } from "./ui";
import type { ZoneRow } from "./types";

export interface BirthdayAnnounceSetting {
  announceActive: boolean;
  announceText: string | null;
  announceName: boolean;
  announceZoneIds: number[];
  announceVoice: string | null;
  announceChime: boolean;
}

const DEFAULTS: BirthdayAnnounceSetting = {
  announceActive: false,
  announceText: null,
  announceName: true,
  announceZoneIds: [],
  announceVoice: null,
  announceChime: true,
};

/**
 * Geburtstags-Ansage (Audio › Zeitpläne): Scannt ein Geburtstagskind am
 * Start-Drehkreuz, kommt einmal am Tag eine Durchsage in den gewählten Zonen.
 * Das Geburtsdatum kommt aus dem Profil der Kunden-App.
 */
export function BirthdayAnnounceCard({
  setting,
  zones,
  voices = TTS_FALLBACK_VOICES,
  appEnabled,
}: {
  setting: BirthdayAnnounceSetting | null;
  zones: ZoneRow[];
  voices?: TtsVoice[];
  /** Kunden-App eingeschaltet (ohne sie gibt es keine Geburtsdaten aus dem Profil). */
  appEnabled: boolean;
}) {
  const router = useRouter();
  const current = setting ?? DEFAULTS;
  const [form, setForm] = useState<(BirthdayAnnounceSetting & { text: string; voice: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const set = (patch: Partial<NonNullable<typeof form>>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const zoneNames = zones.filter((z) => current.announceZoneIds.includes(z.id)).map((z) => z.name);
  const valid = !!form && (!form.announceActive || form.announceZoneIds.length > 0);

  function open() {
    setForm({ ...current, text: current.announceText ?? "", voice: normalizeTtsVoice(current.announceVoice) });
    setError("");
  }

  function toggleZone(id: number) {
    if (!form) return;
    set({
      announceZoneIds: form.announceZoneIds.includes(id)
        ? form.announceZoneIds.filter((z) => z !== id)
        : [...form.announceZoneIds, id],
    });
  }

  async function preview() {
    if (!form) return;
    setPreviewing(true);
    setError("");
    try {
      const res = await fetch("/api/audio/birthday/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announceText: form.text.trim() || null, announceName: form.announceName, announceVoice: form.voice }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error ?? "Probe fehlgeschlagen");
        return;
      }
      audioRef.current?.pause();
      audioRef.current = new Audio(json.url);
      await audioRef.current.play().catch(() => setError("Abspielen im Browser nicht möglich"));
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/audio/birthday", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          announceActive: form.announceActive,
          announceText: form.text.trim() || null,
          announceName: form.announceName,
          announceZoneIds: form.announceZoneIds,
          announceVoice: form.voice,
          announceChime: form.announceChime,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      audioRef.current?.pause();
      setForm(null);
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cake className="h-4 w-4 text-primary shrink-0" />
            Geburtstags-Ansage
          </CardTitle>
          <CardDescription>
            Scannt ein Geburtstagskind am Start-Drehkreuz, gratuliert eine Durchsage, einmal am Tag.
          </CardDescription>
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={open} className="max-sm:h-11">
              <Pencil className="h-4 w-4" />
              Bearbeiten
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={current.announceActive ? "success" : "neutral"} className="font-normal">
              {current.announceActive ? "an" : "aus"}
            </Badge>
            {current.announceActive && (
              <span className="text-sm text-foreground">{zoneNames.length > 0 ? zoneNames.join(", ") : "keine Zone"}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground break-words">
            „{birthdayAnnounceText(current, "Mia")}“
          </p>
          {!appEnabled && current.announceActive && (
            <Notice tone="warning" compact title="Die Kunden-App ist aus. Geburtsdaten kommen aus dem Profil der App." />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => {
        if (o || saving) return;
        audioRef.current?.pause();
        setForm(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Geburtstags-Ansage</DialogTitle>
            <DialogDescription>Beim ersten Scan am Start-Drehkreuz am Geburtstag. Danach an dem Tag nicht noch einmal.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground">
                Durchsage am Geburtstag
                <Switch checked={form.announceActive} onCheckedChange={(v) => set({ announceActive: v })} />
              </label>

              <div>
                <Label htmlFor="bd-ann-text" className="mb-1.5 block">Ansagetext</Label>
                <textarea
                  id="bd-ann-text"
                  className={TEXTAREA_CLASS}
                  rows={3}
                  maxLength={BIRTHDAY_ANNOUNCE_MAX}
                  value={form.text}
                  placeholder={BIRTHDAY_DEFAULT_ANNOUNCE}
                  onChange={(e) => set({ text: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {"{vorname}"} wird durch den Vornamen ersetzt. Ohne Namen fällt er samt Komma weg.
                </p>
              </div>

              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground">
                <span>
                  Vorname nennen
                  <span className="block text-xs text-muted-foreground">Nie der Nachname. Aus: Glückwunsch ohne Namen.</span>
                </span>
                <Switch checked={form.announceName} onCheckedChange={(v) => set({ announceName: v })} />
              </label>

              <div>
                <Label className="mb-1.5 block">Stimme</Label>
                <Select value={form.voice} onValueChange={(v) => set({ voice: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground">
                Gong voranstellen
                <Switch checked={form.announceChime} onCheckedChange={(v) => set({ announceChime: v })} />
              </label>

              <div>
                <Label className="mb-2 block">
                  Zonen · {form.announceZoneIds.length === 0 ? "keine gewählt" : `${form.announceZoneIds.length} ausgewählt`}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {zones.map((zone) => (
                    <Chip key={zone.id} active={form.announceZoneIds.includes(zone.id)} onClick={() => toggleZone(zone.id)}>
                      {zone.name}
                    </Chip>
                  ))}
                </div>
              </div>

              <Notice
                tone="info"
                compact
                title="Jede Person kann die Durchsage in der App auf ihrer Geburtstagskarte für sich abschalten."
              />

              <Button type="button" variant="outline" onClick={preview} disabled={previewing} className="w-full max-sm:h-11">
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Headphones className="h-4 w-4" />}
                Probe hier anhören (mit „Mia“)
              </Button>

              {error && <Notice tone="danger" compact title={error} />}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={saving} className="max-sm:h-11">
                  Abbrechen
                </Button>
                <Button type="button" onClick={save} disabled={saving || !valid} className="min-w-24 max-sm:h-11">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" />Speichern</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
