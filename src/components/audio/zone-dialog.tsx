"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_OPERATING_OFFSET_MINUTES,
  MUSIC_MODE_LABELS,
  describeMusicState,
  hasAudioBackend,
  musicWindowSource,
} from "@/lib/audio-constants";
import {
  operatingSpansForDay,
  seasonForDay,
  type ScheduleSpec,
  type SpanOffsets,
} from "@/lib/operating-hours";
import { formatHhmm, tzMinutesOfDay, tzYmd } from "@/lib/tz-time";
import { Chip, sliderFill } from "./ui";
import type {
  AudioDeviceOption,
  AudioMusicMode,
  AudioSourceKind,
  MusicTimeSpan,
  OperatingScheduleOption,
  PlaylistRow,
  RoomOption,
  StreamRow,
  ZoneRow,
} from "./types";

const NONE = "__none__";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const MUSIC_MODE_HINTS: Record<AudioMusicMode, string> = {
  MANUAL: "Musik läuft, bis jemand sie stoppt.",
  TIMES: "Je Wochentag Start und Ende: zur Startzeit spielt die Zone ihre Quelle, zur Endzeit stoppt sie.",
  OPERATING:
    "Start und Ende kommen aus der Betriebszeit des Raums, samt Saison und Ausnahmetagen.",
};

/** Ein Wochentag im Editor; ausgeschaltete Tage behalten ihre Zeiten zum Wiedereinschalten. */
interface DayDraft {
  enabled: boolean;
  from: string;
  to: string;
}

const DEFAULT_DAY: DayDraft = { enabled: false, from: "10:00", to: "20:00" };

/**
 * Wochenplan zum Bearbeiten. Ohne gespeicherte Musikzeiten schlägt er die
 * Betriebszeit des Raums vor – die heute gültige Saison, sonst die erste mit
 * Zeiten –, und ohne die täglich 10–20 Uhr.
 */
function initialDays(
  times: MusicTimeSpan[],
  roomSpec: ScheduleSpec | undefined,
  timeZone: string
): DayDraft[] {
  if (times.length > 0) {
    return WEEKDAYS.map((_, weekday) => {
      const t = times.find((x) => x.weekday === weekday);
      return t ? { enabled: true, from: t.from, to: t.to } : DEFAULT_DAY;
    });
  }
  const season = roomSpec
    ? (seasonForDay(roomSpec, tzYmd(new Date(), timeZone)) ??
      roomSpec.seasons.find((s) => s.periods.length > 0))
    : undefined;
  if (season && season.periods.length > 0) {
    return WEEKDAYS.map((_, weekday) => {
      const p = season.periods.find((x) => x.weekday === weekday);
      return p ? { enabled: true, from: p.opensAt, to: p.closesAt } : DEFAULT_DAY;
    });
  }
  return WEEKDAYS.map(() => ({ ...DEFAULT_DAY, enabled: true }));
}

function daysToTimes(days: DayDraft[]): MusicTimeSpan[] {
  return days.flatMap((d, weekday) => (d.enabled ? [{ weekday, from: d.from, to: d.to }] : []));
}

/** Was „Start“ in dieser Zone abspielt. */
const SOURCES: { value: AudioSourceKind; label: string; hint: string }[] = [
  { value: "PLAYLIST", label: "Playlist", hint: "Spielt die Standard-Playlist der Zone." },
  { value: "STREAM", label: "Webradio", hint: "Spielt den gewählten Sender." },
  { value: "SILENCE", label: "Keine Musik", hint: "Zone macht nur Durchsagen." },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  zone: ZoneRow | null;
  devices: AudioDeviceOption[];
  playlists: PlaylistRow[];
  streams: StreamRow[];
  rooms: RoomOption[];
  /** Betriebszeiten samt Wochenplan – für die Vorschau „heute 09:30–20:30“. */
  operatingSchedules: OperatingScheduleOption[];
  /** Zeitzone des Accounts. */
  timeZone: string;
}

/**
 * Musikfenster des heutigen Tags als Text, damit man beim Einstellen sieht,
 * was dabei herauskommt.
 */
function describeTodayMusicWindow(
  spec: ScheduleSpec,
  offsets: SpanOffsets,
  timeZone: string
): string {
  const spans = operatingSpansForDay(spec, tzYmd(new Date(), timeZone), timeZone, offsets);
  if (spans.length === 0) return "heute keine Musik";
  return `heute ${spans
    .map(
      (span) =>
        `${formatHhmm(tzMinutesOfDay(span.from, timeZone))}–${formatHhmm(tzMinutesOfDay(span.to, timeZone))}`
    )
    .join(" · ")}`;
}

export function ZoneDialog({
  open,
  onClose,
  onSaved,
  zone,
  devices,
  playlists,
  streams,
  rooms,
  operatingSchedules,
  timeZone,
}: Props) {
  const isEdit = !!zone;
  const [name, setName] = useState(zone?.name ?? "");
  const [deviceId, setDeviceId] = useState<string>(zone?.deviceId ? String(zone.deviceId) : NONE);
  const [roomId, setRoomId] = useState<string>(zone?.roomId ? String(zone.roomId) : NONE);
  const [playlistId, setPlaylistId] = useState<string>(
    zone?.playlistId ? String(zone.playlistId) : NONE
  );
  const [streamId, setStreamId] = useState<string>(
    zone?.streamId
      ? String(zone.streamId)
      : zone?.streamUrl
        ? (streams.find((s) => s.url === zone.streamUrl)?.id.toString() ?? NONE)
        : NONE
  );
  // Eine neue Zone ohne Playlist-Auswahl startet als reine Durchsagen-Zone,
  // sonst müsste man erst eine Quelle bestücken, um speichern zu können.
  const [defaultSource, setDefaultSource] = useState<AudioSourceKind>(
    zone?.defaultSource ?? (playlists.length > 0 ? "PLAYLIST" : "SILENCE")
  );
  const [syncGroup, setSyncGroup] = useState(zone?.syncGroup ?? "");
  const [volume, setVolume] = useState(zone?.volume ?? 50);
  const [announcementVolume, setAnnouncementVolume] = useState(zone?.announcementVolume ?? 85);
  const [duckVolume, setDuckVolume] = useState(zone?.duckVolume ?? 15);
  const [musicMode, setMusicMode] = useState<AudioMusicMode>(zone?.musicMode ?? "MANUAL");
  const [days, setDays] = useState<DayDraft[]>(() => {
    const room = rooms.find((r) => r.id === zone?.roomId);
    const spec = operatingSchedules.find((s) => s.id === room?.operatingScheduleId);
    return initialDays(zone?.musicTimes ?? [], spec, timeZone);
  });
  const [musicOpenOffset, setMusicOpenOffset] = useState(zone?.musicOpenOffset ?? 0);
  const [musicCloseOffset, setMusicCloseOffset] = useState(zone?.musicCloseOffset ?? 0);
  const [airplayEnabled, setAirplayEnabled] = useState(zone?.airplayEnabled ?? false);
  const [bluetoothEnabled, setBluetoothEnabled] = useState(zone?.bluetoothEnabled ?? false);
  const [externalName, setExternalName] = useState(zone?.externalName ?? "");
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bereits belegte Abspieler ausblenden – außer dem eigenen.
  const availableDevices = devices.filter((d) => !d.taken || d.id === zone?.deviceId);

  // Welcher Empfang möglich ist, entscheidet der Abspieler: er meldet im
  // Heartbeat, welche Dienste auf ihm eingerichtet sind. Ohne Meldung bleibt der
  // Schalter gesperrt, sonst stünde im Dashboard eine Einstellung, die der Pi
  // nicht umsetzt.
  const selected = devices.find((d) => String(d.id) === deviceId);
  const backends = selected?.backends ?? [];
  const canAirplay = hasAudioBackend(backends, "AIRPLAY");
  const canBluetooth = hasAudioBackend(backends, "BLUETOOTH");

  // Was die Automatik mit diesen Einstellungen tun würde – zu sehen beim
  // Einstellen und nicht erst, wenn die Musik morgens ausbleibt.
  const selectedRoom = rooms.find((room) => String(room.id) === roomId);
  const roomSpec =
    selectedRoom?.operatingScheduleId != null
      ? operatingSchedules.find((s) => s.id === selectedRoom.operatingScheduleId)
      : undefined;
  const draftMusic = {
    musicMode,
    musicTimes: daysToTimes(days),
    musicOpenOffset,
    musicCloseOffset,
  };
  const musicSource = musicWindowSource(draftMusic, roomSpec);
  const musicState = describeMusicState(draftMusic, roomSpec, new Date(), timeZone);
  const musicHint =
    musicMode !== "OPERATING"
      ? null
      : !selectedRoom
        ? "Ohne Raum gibt es keine Betriebszeit – die Musik läuft dann jederzeit. Oben einen Raum wählen oder „Eigene Zeiten“ nehmen."
        : !selectedRoom.operatingScheduleName
          ? `Der Raum „${selectedRoom.name}“ hat keine Betriebszeit – die Musik läuft jederzeit. Unter „Räume“ eine zuordnen oder „Eigene Zeiten“ nehmen.`
          : musicState?.warn
            ? `Die Betriebszeit „${selectedRoom.operatingScheduleName}“ hat in den nächsten Tagen keine Öffnungszeit, etwa weil die Saison abgelaufen ist – die Musik bleibt aus. Unter „Räume“ ergänzen oder „Eigene Zeiten“ nehmen.`
            : null;

  function updateDay(weekday: number, patch: Partial<DayDraft>) {
    setDays((current) => current.map((d, i) => (i === weekday ? { ...d, ...patch } : d)));
  }

  /** Zeiten des ersten eingeschalteten Tags auf alle eingeschalteten übertragen. */
  function copyFirstDay() {
    const first = days.find((d) => d.enabled);
    if (!first) return;
    setDays((current) => current.map((d) => (d.enabled ? { ...d, from: first.from, to: first.to } : d)));
  }
  const firstEnabled = days.findIndex((d) => d.enabled);

  const validOffsets =
    Math.abs(musicOpenOffset) <= MAX_OPERATING_OFFSET_MINUTES &&
    Math.abs(musicCloseOffset) <= MAX_OPERATING_OFFSET_MINUTES;

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Name ist erforderlich");
      return;
    }
    // Eine Quelle ohne Inhalt liesse sich später nicht starten.
    if (defaultSource === "PLAYLIST" && playlistId === NONE) {
      setError("Für die Quelle „Playlist“ eine Standard-Playlist auswählen");
      return;
    }
    if (defaultSource === "STREAM" && streamId === NONE) {
      setError(
        streams.length === 0
          ? "Zuerst unter „Webradio“ einen Sender anlegen"
          : "Für die Quelle „Webradio“ einen Sender auswählen"
      );
      return;
    }
    // Bei einem Wechsel auf einen anderen Abspieler kann ein Empfänger übrig
    // bleiben, den der neue nicht bedient.
    if (airplayEnabled && !canAirplay) {
      setError("Der gewählte Abspieler hat den AirPlay-Empfang nicht eingerichtet");
      return;
    }
    if (bluetoothEnabled && !canBluetooth) {
      setError("Der gewählte Abspieler hat den Bluetooth-Empfang nicht eingerichtet");
      return;
    }
    if (musicMode === "OPERATING" && !validOffsets) {
      setError(`Der Versatz darf höchstens ${MAX_OPERATING_OFFSET_MINUTES} Minuten betragen`);
      return;
    }
    if (musicMode === "TIMES") {
      if (firstEnabled < 0) {
        setError("Für „Eigene Zeiten“ mindestens einen Tag einschalten");
        return;
      }
      const bad = days.findIndex((d) => d.enabled && (!d.from || !d.to || d.from === d.to));
      if (bad >= 0) {
        setError(`${WEEKDAYS[bad]}: Start und Ende angeben – beide dürfen nicht gleich sein`);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        deviceId: deviceId === NONE ? null : Number(deviceId),
        keyRoomId: roomId === NONE ? null : Number(roomId),
        playlistId: playlistId === NONE ? null : Number(playlistId),
        streamId: streamId === NONE ? null : Number(streamId),
        defaultSource,
        syncGroup: syncGroup.trim() || null,
        volume,
        announcementVolume,
        duckVolume,
        musicMode,
        ...(musicMode === "TIMES" ? { musicTimes: daysToTimes(days) } : {}),
        musicOpenOffset: musicMode === "OPERATING" ? musicOpenOffset : 0,
        musicCloseOffset: musicMode === "OPERATING" ? musicCloseOffset : 0,
        airplayEnabled,
        bluetoothEnabled,
        externalName: externalName.trim() || null,
        isActive,
      };
      const res = await fetch(isEdit ? `/api/audio/zones/${zone!.id}` : "/api/audio/zones", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Zone bearbeiten" : "Neue Zone"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="az-name">Name</Label>
            <Input
              id="az-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Außengelände Seilbahn"
            />
          </div>

          <div>
            <Label>Abspieler</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger>
                <SelectValue placeholder="Kein Gerät" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Kein Gerät (nur geplant)</SelectItem>
                {availableDevices.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableDevices.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Noch kein freies Audio-Gerät. Unter „Geräte&quot; einen Abspieler vom Typ
                AUDIO_PLAYER anlegen.
              </p>
            )}
          </div>

          <div>
            <Label>Raum</Label>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger>
                <SelectValue placeholder="Kein Raum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Kein Raum</SelectItem>
                {rooms.map((room) => (
                  <SelectItem key={room.id} value={String(room.id)}>
                    {room.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Über den Raum bekommt die Zone ihre Betriebszeit: Zeitpläne mit „Betriebsbeginn“
              oder „Betriebsende“ richten sich danach, und die Zone erscheint im Raum-Leitstand.
            </p>
          </div>

          <div>
            <Label>Quelle</Label>
            <Select
              value={defaultSource}
              onValueChange={(v) => setDefaultSource(v as AudioSourceKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {SOURCES.find((s) => s.value === defaultSource)?.hint}
            </p>
          </div>

          <div>
            <Label>Standard-Playlist</Label>
            <Select value={playlistId} onValueChange={setPlaylistId}>
              <SelectTrigger>
                <SelectValue placeholder="Keine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Keine</SelectItem>
                {playlists.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Webradio</Label>
            <Select value={streamId} onValueChange={setStreamId}>
              <SelectTrigger>
                <SelectValue placeholder="Kein Sender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Kein Sender</SelectItem>
                {streams.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {streams.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Noch kein Sender. Unter dem Reiter „Webradio“ anlegen, dann hier
                auswählen.
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="az-sync">Sync-Gruppe (optional)</Label>
            <Input
              id="az-sync"
              value={syncGroup}
              onChange={(e) => setSyncGroup(e.target.value)}
              placeholder="z. B. aussen"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Zonen mit gleicher Sync-Gruppe spielen synchron – nötig, wenn man sie
              gleichzeitig hört.
            </p>
          </div>

          {/* Am Telefon untereinander: nebeneinander blieben je 90 px, in denen
              die Beschriftung „Durchsage · 85 %" umbrach. */}
          <div className="grid gap-1 sm:grid-cols-3 sm:gap-3">
            <VolumeField label="Musik" value={volume} onChange={setVolume} />
            <VolumeField
              label="Durchsage"
              value={announcementVolume}
              onChange={setAnnouncementVolume}
            />
            <VolumeField label="Ducking" value={duckVolume} onChange={setDuckVolume} />
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3 dark:border-border">
            <div>
              <Label>Musik automatisch an und aus</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(Object.keys(MUSIC_MODE_LABELS) as AudioMusicMode[]).map((mode) => (
                  <Chip key={mode} active={musicMode === mode} onClick={() => setMusicMode(mode)}>
                    {MUSIC_MODE_LABELS[mode]}
                  </Chip>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{MUSIC_MODE_HINTS[musicMode]}</p>
            </div>

            {musicMode === "TIMES" && (
              <div className="space-y-1.5">
                {days.map((day, weekday) => (
                  <div
                    key={WEEKDAYS[weekday]}
                    className="grid grid-cols-[auto_1.75rem_1fr_auto_1fr] items-center gap-2"
                  >
                    <Switch
                      checked={day.enabled}
                      onCheckedChange={(enabled) => updateDay(weekday, { enabled })}
                      aria-label={`Musik am ${WEEKDAYS[weekday]}`}
                    />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        day.enabled ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {WEEKDAYS[weekday]}
                    </span>
                    <Input
                      type="time"
                      value={day.from}
                      onChange={(e) => updateDay(weekday, { from: e.target.value })}
                      disabled={!day.enabled}
                      aria-label={`${WEEKDAYS[weekday]} Start`}
                      className="h-10 px-2 sm:h-9"
                    />
                    <span className="text-xs text-muted-foreground">bis</span>
                    <Input
                      type="time"
                      value={day.to}
                      onChange={(e) => updateDay(weekday, { to: e.target.value })}
                      disabled={!day.enabled}
                      aria-label={`${WEEKDAYS[weekday]} Ende`}
                      className="h-10 px-2 sm:h-9"
                    />
                  </div>
                ))}
                {firstEnabled >= 0 && days.filter((d) => d.enabled).length > 1 && (
                  <button
                    type="button"
                    onClick={copyFirstDay}
                    className="min-h-10 text-xs font-medium text-primary hover:underline sm:min-h-0"
                  >
                    Zeiten von {WEEKDAYS[firstEnabled]} für alle eingeschalteten Tage übernehmen
                  </button>
                )}
                <p className="text-xs text-muted-foreground">
                  Ende vor Start läuft über Mitternacht, z. B. 18:00 bis 02:00.
                </p>
              </div>
            )}

            {musicMode === "OPERATING" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <OffsetField
                    id="az-open-offset"
                    label="Betriebsbeginn"
                    value={musicOpenOffset}
                    onChange={setMusicOpenOffset}
                  />
                  <OffsetField
                    id="az-close-offset"
                    label="Betriebsende"
                    value={musicCloseOffset}
                    onChange={setMusicCloseOffset}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Verschiebung in Minuten: negativ = vorher, positiv = nachher. „−30“ beim
                  Beginn heißt: Musik ab einer halben Stunde vor Betriebsbeginn.
                </p>
                {musicHint && <p className="text-xs text-warning">{musicHint}</p>}
              </>
            )}

            {musicSource && musicState && !musicHint && (
              <p className={cn("text-xs", musicState.warn ? "text-warning" : "text-foreground/80")}>
                {musicMode === "OPERATING" && `${selectedRoom?.operatingScheduleName}: `}
                {describeTodayMusicWindow(musicSource.spec, musicSource.offsets, timeZone)} ·{" "}
                {musicState.text}
              </p>
            )}

            {musicMode !== "MANUAL" && (
              <>
                {defaultSource === "SILENCE" && (
                  <p className="text-xs text-warning">
                    Als Quelle ist „Keine Musik“ eingestellt – zur Startzeit startet nichts.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Außerhalb startet keine eigene Musik, auch nicht per Hand. Ein Stopp
                  zwischendurch gilt bis zur nächsten Startzeit. Durchsagen, AirPlay und
                  Bluetooth laufen immer.
                </p>
              </>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3 dark:border-border">
            <div>
              <Label>Senden vom Handy</Label>
              <p className="text-xs text-muted-foreground">
                Ein Sender übernimmt die Zone, sobald er sich verbindet. Die eingestellte
                Quelle läuft danach von selbst weiter. Durchsagen haben weiter Vorrang.
              </p>
            </div>

            <ReceiverSwitch
              label="AirPlay"
              hint="iPhone, iPad oder Mac im selben Netz."
              checked={airplayEnabled}
              onCheckedChange={setAirplayEnabled}
              available={canAirplay}
            />
            <ReceiverSwitch
              label="Bluetooth"
              hint="Kopplung wird auf der Zonenkarte freigegeben."
              checked={bluetoothEnabled}
              onCheckedChange={setBluetoothEnabled}
              available={canBluetooth}
            />

            {(airplayEnabled || bluetoothEnabled) && (
              <div>
                <Label htmlFor="az-extname">Angezeigter Name (optional)</Label>
                <Input
                  id="az-extname"
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                  placeholder={name.trim() || "Name der Zone"}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  So erscheint die Zone auf dem Handy. Leer heißt: der Name der Zone.
                </p>
              </div>
            )}

            {deviceId === NONE && (
              <p className="text-xs text-muted-foreground">
                Erst mit einem zugeordneten Abspieler möglich.
              </p>
            )}
          </div>

          <label className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground sm:min-h-0 dark:text-foreground/80">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            Zone aktiv
          </label>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/30">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={saving} className={cn("gap-1.5", saving && "opacity-80")}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ein Empfänger mit Schalter. Nicht eingerichtet heißt gesperrt und nicht
 * versteckt: sonst sucht man im Dashboard nach einer Einstellung, die auf dem
 * Pi zu holen ist.
 */
function ReceiverSwitch({
  label,
  hint,
  checked,
  onCheckedChange,
  available,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  available: boolean;
}) {
  return (
    <label
      className={cn(
        "flex min-h-10 items-start gap-2.5 text-sm sm:min-h-0",
        available ? "text-muted-foreground" : "text-muted-foreground/70"
      )}
    >
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={!available}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0">
        {label}
        <span className="block text-xs text-muted-foreground">
          {available
            ? hint
            : "Auf dem Abspieler nicht eingerichtet – install-audio.sh erneut ausführen"}
        </span>
      </span>
    </label>
  );
}

/** Versatz in Minuten gegenüber Betriebsbeginn bzw. -ende. */
function OffsetField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          min={-MAX_OPERATING_OFFSET_MINUTES}
          max={MAX_OPERATING_OFFSET_MINUTES}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        <span className="shrink-0 text-xs text-muted-foreground">Min.</span>
      </div>
    </div>
  );
}

function VolumeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label>
        {label} · {value}%
      </Label>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={`${value} Prozent`}
        style={sliderFill(value)}
        className="touch-slider w-full"
      />
    </div>
  );
}
