"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
import { Loader2, Megaphone, Mic, TriangleAlert, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TTS_VOICE,
  MAX_ANNOUNCEMENT_CHARS,
  TTS_FALLBACK_VOICES,
  type TtsVoice,
} from "@/lib/audio-constants";
import { Chip, TEXTAREA_CLASS } from "./ui";
import { LiveBroadcastCard } from "./live-broadcast";
import type { AnnouncementRow, ZoneRow } from "./types";
import type { LiveBroadcast } from "./use-live-broadcast";

interface Props {
  zones: ZoneRow[];
  templates: AnnouncementRow[];
  onDone: () => void;
  /** Von der API gemeldete Stimmen; leer nur, wenn die Abfrage nicht durchkam. */
  voices?: TtsVoice[];
  /** Live-Durchsage – lebt auf Seitenebene, damit ein Tabwechsel sie nicht beendet. */
  live: LiveBroadcast;
}

export function AnnouncePanel({
  zones,
  templates,
  onDone,
  voices = TTS_FALLBACK_VOICES,
  live,
}: Props) {
  const activeZones = zones.filter((z) => z.isActive);
  const [selectedZones, setSelectedZones] = useState<number[]>([]);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(DEFAULT_TTS_VOICE);
  const [chime, setChime] = useState(true);
  const [emergency, setEmergency] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const liveActive = live.phase !== "idle";

  function toggleZone(id: number) {
    setSelectedZones((prev) =>
      prev.includes(id) ? prev.filter((z) => z !== id) : [...prev, id]
    );
  }

  const targetLabel =
    selectedZones.length === 0
      ? `alle ${activeZones.length} Zonen`
      : `${selectedZones.length} von ${activeZones.length} Zonen`;

  async function sendText() {
    setError(null);
    setNotice(null);
    live.dismiss();
    if (!text.trim()) {
      setError("Bitte einen Ansagetext eingeben");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/audio/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          voice,
          chime,
          emergency,
          zoneIds: selectedZones,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Durchsage fehlgeschlagen");
        return;
      }
      setNotice(`Durchsage an ${data.queued} Zone${data.queued === 1 ? "" : "n"} geschickt`);
      setText("");
      onDone();
    } finally {
      setSending(false);
    }
  }

  async function playTemplate(template: AnnouncementRow) {
    setError(null);
    setNotice(null);
    live.dismiss();
    setSending(true);
    try {
      const res = await fetch(`/api/audio/announcements/${template.id}/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneIds: selectedZones }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Durchsage fehlgeschlagen");
        return;
      }
      setNotice(`„${template.name}" läuft in ${data.queued} Zone${data.queued === 1 ? "" : "n"}`);
      onDone();
    } finally {
      setSending(false);
    }
  }

  function startLive() {
    setError(null);
    setNotice(null);
    void live.start({ zoneIds: selectedZones, chime, emergency });
  }

  if (activeZones.length === 0) {
    return (
      <Card className="py-0 sm:py-0">
        <EmptyState
          icon={Volume2}
          title="Noch keine Zone"
          description="Lege zuerst unter „Zonen&quot; eine Beschallungszone an."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {liveActive && <LiveBroadcastCard live={live} />}

      <Card>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-2 block">Zielzonen · {targetLabel}</Label>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                active={selectedZones.length === 0}
                onClick={() => setSelectedZones([])}
                disabled={liveActive}
              >
                Alle Zonen
              </Chip>
              {activeZones.map((zone) => (
                <Chip
                  key={zone.id}
                  active={selectedZones.includes(zone.id)}
                  onClick={() => toggleZone(zone.id)}
                  disabled={liveActive}
                >
                  {zone.name}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label htmlFor="announce-text">Ansagetext</Label>
              <span className="text-xs text-muted-foreground">
                {text.length}/{MAX_ANNOUNCEMENT_CHARS}
              </span>
            </div>
            <textarea
              id="announce-text"
              value={text}
              maxLength={MAX_ANNOUNCEMENT_CHARS}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="z. B. Der Anfängerkurs beginnt in fünf Minuten an Seilbahn A."
              className={TEXTAREA_CLASS}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">Stimme</Label>
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Der Schalter selbst ist 18 px hoch; die Zeile drumherum macht
                daraus am Telefon eine greifbare Fläche. */}
            <div className="flex flex-col justify-end gap-1">
              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-0">
                <Switch checked={chime} onCheckedChange={setChime} disabled={liveActive} />
                Gong voranstellen
              </label>

              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-0">
                <Switch checked={emergency} onCheckedChange={setEmergency} disabled={liveActive} />
                <span className="flex items-center gap-1">
                  <TriangleAlert
                    className={cn("h-3.5 w-3.5", emergency ? "text-destructive" : "text-muted-foreground")}
                  />
                  Notfall (unterbricht alles)
                </span>
              </label>
            </div>
          </div>

          {/* Am Telefon volle Breite: die Durchsage ist die Hauptaktion dieser
              Seite und wird oft im Vorbeigehen ausgelöst. */}
          <div className="grid gap-2 pt-1 sm:flex sm:flex-wrap">
            <Button
              onClick={sendText}
              disabled={sending || liveActive}
              className="h-11 gap-1.5 sm:h-9"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Megaphone className="h-4 w-4" />
              )}
              Durchsage abspielen
            </Button>

            <Button
              onClick={startLive}
              variant="outline"
              disabled={sending || liveActive}
              className="h-11 gap-1.5 sm:h-9"
            >
              <Mic className="h-4 w-4" />
              Live-Durchsage starten
            </Button>
          </div>

          {(notice ?? live.notice) && (
            <Notice tone="success" compact title={notice ?? live.notice} />
          )}
          {(error ?? live.error) && (
            <Notice tone="danger" compact title={error ?? live.error} />
          )}
        </CardContent>
      </Card>

      {templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Gespeicherte Durchsagen</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Handy: untereinander in voller Breite; lange Namen brechen um, statt über die Karte zu ragen. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {templates.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  disabled={sending || liveActive}
                  onClick={() => playTemplate(template)}
                  className="h-auto min-h-11 justify-start gap-1.5 whitespace-normal py-2 text-left sm:min-h-8 sm:py-1.5"
                >
                  <Megaphone className="h-3.5 w-3.5" />
                  {template.name}
                  {template.priority >= 100 && (
                    <Badge variant="danger" className="text-[10px]">
                      Notfall
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
