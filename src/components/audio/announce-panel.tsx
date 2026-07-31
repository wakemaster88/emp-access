"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { Loader2, Megaphone, Mic, Square, TriangleAlert, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TTS_VOICE,
  MAX_ANNOUNCEMENT_CHARS,
  TTS_FALLBACK_VOICES,
  type TtsVoice,
} from "@/lib/audio-constants";
import { Chip, TEXTAREA_CLASS } from "./ui";
import type { AnnouncementRow, ZoneRow } from "./types";

interface Props {
  zones: ZoneRow[];
  templates: AnnouncementRow[];
  onDone: () => void;
  /** Von der API gemeldete Stimmen; leer nur, wenn die Abfrage nicht durchkam. */
  voices?: TtsVoice[];
}

export function AnnouncePanel({
  zones,
  templates,
  onDone,
  voices = TTS_FALLBACK_VOICES,
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

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

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

  async function startRecording() {
    setError(null);
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void uploadRecording(new Blob(chunksRef.current, { type: recorder.mimeType }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      setError("Kein Zugriff auf das Mikrofon – bitte im Browser erlauben");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function uploadRecording(blob: Blob) {
    setSending(true);
    try {
      const { upload } = await import("@vercel/blob/client");
      const extension = blob.type.includes("ogg") ? "ogg" : "webm";
      const uploaded = await upload(`durchsage-${Date.now()}.${extension}`, blob, {
        access: "public",
        handleUploadUrl: "/api/audio/upload",
        contentType: blob.type,
      });

      const res = await fetch("/api/audio/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: uploaded.url,
          blobPathname: uploaded.pathname,
          contentType: blob.type,
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
      setNotice(`Aufnahme an ${data.queued} Zone${data.queued === 1 ? "" : "n"} geschickt`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setSending(false);
    }
  }

  if (activeZones.length === 0) {
    return (
      <Card className="border-dashed border-slate-300 dark:border-slate-700">
        <CardContent className="py-10 text-center">
          <Volume2 className="h-10 w-10 mx-auto text-slate-400 mb-3" />
          <h3 className="font-semibold text-slate-700 dark:text-slate-300">Noch keine Zone</h3>
          <p className="text-sm text-slate-500 mt-1">
            Lege zuerst unter „Zonen&quot; eine Beschallungszone an.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 dark:border-slate-800">
        <CardContent className="p-4 space-y-4">
          <div>
            <Label className="mb-2 block">Zielzonen · {targetLabel}</Label>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={selectedZones.length === 0} onClick={() => setSelectedZones([])}>
                Alle Zonen
              </Chip>
              {activeZones.map((zone) => (
                <Chip
                  key={zone.id}
                  active={selectedZones.includes(zone.id)}
                  onClick={() => toggleZone(zone.id)}
                >
                  {zone.name}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label htmlFor="announce-text">Ansagetext</Label>
              <span className="text-xs text-slate-500">
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
              <label className="flex min-h-10 items-center gap-2 text-sm text-slate-600 sm:min-h-0 dark:text-slate-300">
                <Switch checked={chime} onCheckedChange={setChime} />
                Gong voranstellen
              </label>

              <label className="flex min-h-10 items-center gap-2 text-sm text-slate-600 sm:min-h-0 dark:text-slate-300">
                <Switch checked={emergency} onCheckedChange={setEmergency} />
                <span className="flex items-center gap-1">
                  <TriangleAlert
                    className={cn("h-3.5 w-3.5", emergency ? "text-red-600" : "text-slate-400")}
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
              disabled={sending || recording}
              className="h-11 gap-1.5 sm:h-9"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Megaphone className="h-4 w-4" />
              )}
              Durchsage abspielen
            </Button>

            {recording ? (
              <Button
                onClick={stopRecording}
                variant="outline"
                className="h-11 gap-1.5 border-red-500 text-red-600 sm:h-9"
              >
                <Square className="h-4 w-4 fill-current" />
                Aufnahme beenden ({recordSeconds}s)
              </Button>
            ) : (
              <Button
                onClick={startRecording}
                variant="outline"
                disabled={sending}
                className="h-11 gap-1.5 sm:h-9"
              >
                <Mic className="h-4 w-4" />
                Live sprechen
              </Button>
            )}
          </div>

          {notice && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/40">
              {notice}
            </p>
          )}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 p-2.5 rounded-lg border border-red-200 dark:border-red-900/40">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {templates.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-4">
            <Label className="mb-2 block">Gespeicherte Durchsagen</Label>
            <div className="flex flex-wrap gap-2">
              {templates.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  disabled={sending}
                  onClick={() => playTemplate(template)}
                  className="h-10 gap-1.5 sm:h-8"
                >
                  <Megaphone className="h-3.5 w-3.5" />
                  {template.name}
                  {template.priority >= 100 && (
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-[10px]">
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
