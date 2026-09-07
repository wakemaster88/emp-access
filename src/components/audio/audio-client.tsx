"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Airplay,
  AlertTriangle,
  Bluetooth,
  BluetoothSearching,
  CalendarClock,
  CheckCircle2,
  Clock,
  Headphones,
  History,
  ListMusic,
  Loader2,
  Megaphone,
  Music,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Speaker,
  Square,
  Trash2,
  Volume2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUDIO_OPERATING_LABELS,
  SCHEDULE_WINDOW_MINUTES,
  describeMusicWindow,
  describeScheduleTiming,
  formatDaysOfWeek,
  nextScheduleRunLabel,
  type TtsVoice,
} from "@/lib/audio-constants";
import { describeOccurrence, nextOperatingOccurrence } from "@/lib/operating-hours";
import { scheduleOperatingSpecs, scheduleWarnings } from "./schedule-warnings";
import { AnnouncePanel } from "./announce-panel";
import { Chip, sliderFill } from "./ui";
import { AnnouncementDialog } from "./announcement-dialog";
import { LibraryPanel } from "./library-panel";
import {
  EXTERNAL_LABELS,
  JOB_KIND_LABELS,
  JOB_STATUS_LABELS,
  formatCountdown,
  formatDuration,
  formatRelativeTime,
  isJobStuck,
  triggerLabel,
} from "./labels";
import { PlaylistDialog } from "./playlist-dialog";
import { StreamDialog } from "./stream-dialog";
import { ScheduleDialog, ACTION_LABELS } from "./schedule-dialog";
import { useAudioStatus } from "./use-audio-status";
import { useZoneMonitor, zoneSource } from "./use-zone-monitor";
import { ZoneDialog } from "./zone-dialog";
import { ZoneStatusBar } from "./zone-status-bar";
import type {
  AnnouncementRow,
  AudioDeviceOption,
  JobRow,
  OperatingScheduleOption,
  PlaylistRow,
  RoomOption,
  ScheduleRow,
  StreamRow,
  TrackRow,
  ZoneRow,
  ZoneStatus,
} from "./types";

interface Props {
  zones: ZoneRow[];
  tracks: TrackRow[];
  playlists: PlaylistRow[];
  streams: StreamRow[];
  announcements: AnnouncementRow[];
  schedules: ScheduleRow[];
  jobs: JobRow[];
  audioDevices: AudioDeviceOption[];
  ttsVoices: TtsVoice[];
  /** Räume zur Zuordnung einer Zone. */
  rooms: RoomOption[];
  /** Betriebszeiten samt Wochenplan – für Zeitpläne mit Betriebsbeginn/-ende. */
  operatingSchedules: OperatingScheduleOption[];
  /** Zeitzone des Accounts – Zeitpläne gelten in ihr, nicht in der des Browsers. */
  timeZone: string;
}

/**
 * Nächster Termin eines Zeitplans als Klartext. Bei Betriebsbeginn/-ende
 * hängt er von der Betriebszeit ab – richten sich die Zielzonen nach
 * verschiedenen, zählt die früheste und die Angabe sagt das dazu.
 */
function nextRunLabel(
  schedule: ScheduleRow,
  zones: ZoneRow[],
  operatingSchedules: OperatingScheduleOption[],
  timeZone: string
): string {
  const now = new Date();
  if (schedule.trigger === "TIME") {
    return nextScheduleRunLabel(schedule, now, timeZone) ?? "Kein Wochentag gewählt";
  }
  const { specs } = scheduleOperatingSpecs(schedule, zones, operatingSchedules);
  if (specs.length === 0) return "Keine Betriebszeit zuständig";
  const trigger = {
    kind: schedule.trigger === "OPENING" ? ("open" as const) : ("close" as const),
    offsetMinutes: schedule.offsetMinutes,
    daysOfWeek: schedule.daysOfWeek,
  };
  const next = specs
    .map((spec) => nextOperatingOccurrence(spec, trigger, now, timeZone, SCHEDULE_WINDOW_MINUTES * 60_000))
    .filter((occ): occ is NonNullable<typeof occ> => occ !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (!next) return "Kein Termin in den nächsten Tagen";
  return specs.length > 1
    ? `${describeOccurrence(next, now, timeZone)} (je Raum verschieden)`
    : describeOccurrence(next, now, timeZone);
}

export function AudioClient({
  zones,
  tracks,
  playlists,
  streams,
  announcements,
  schedules,
  jobs,
  audioDevices,
  ttsVoices,
  rooms,
  operatingSchedules,
  timeZone,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("announce");
  const [highlightZone, setHighlightZone] = useState<number | null>(null);

  const { zones: liveZones, jobs: liveJobs, refresh: refreshStatus } = useAudioStatus(true);
  const monitor = useZoneMonitor({ tracks, playlists });

  const [zoneDialog, setZoneDialog] = useState<{ open: boolean; zone: ZoneRow | null }>({
    open: false,
    zone: null,
  });
  const [playlistDialog, setPlaylistDialog] = useState<{
    open: boolean;
    playlist: PlaylistRow | null;
  }>({ open: false, playlist: null });
  const [streamDialog, setStreamDialog] = useState<{
    open: boolean;
    stream: StreamRow | null;
  }>({ open: false, stream: null });
  const [announcementDialog, setAnnouncementDialog] = useState<{
    open: boolean;
    announcement: AnnouncementRow | null;
  }>({ open: false, announcement: null });
  const [scheduleDialog, setScheduleDialog] = useState<{
    open: boolean;
    schedule: ScheduleRow | null;
  }>({ open: false, schedule: null });

  const [busyZone, setBusyZone] = useState<number | null>(null);
  const [controlError, setControlError] = useState<{ zoneId: number; message: string } | null>(
    null
  );
  const [deleteConfirm, setDeleteConfirm] = useState<{
    kind: "zone" | "playlist" | "stream" | "announcement" | "schedule";
    id: number;
    name: string;
  } | null>(null);

  // Die Hervorhebung dient nur dem Wiederfinden nach dem Sprung aus der
  // Statusleiste und verschwindet danach wieder.
  useEffect(() => {
    if (highlightZone === null) return;
    const timer = setTimeout(() => setHighlightZone(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightZone]);

  const templates = announcements.filter((a) => a.isTemplate);

  /** Wer die Zone gerade übernommen hat – der Livewert schlägt den der Seite. */
  function takeoverOf(zone: ZoneRow) {
    const live = liveZones.get(zone.id);
    return live ? live.externalActive : zone.externalActive;
  }

  // Beim Mithören liefe die eigene Quelle im Browser weiter, während sie in der
  // Zone pausiert ist – man hörte etwas, das dort gar nicht läuft.
  const monitoredTakenOver =
    monitor.zoneId !== null && !!liveZones.get(monitor.zoneId)?.externalActive;
  const stopMonitor = monitor.stop;
  useEffect(() => {
    if (monitoredTakenOver) stopMonitor();
  }, [monitoredTakenOver, stopMonitor]);

  // Der Verlauf kommt live nach, sobald die erste Statusabfrage durch ist.
  const historyJobs = liveJobs ?? jobs;

  function refresh() {
    startTransition(() => router.refresh());
    void refreshStatus();
  }

  function showZone(zoneId: number) {
    setTab("zones");
    setHighlightZone(zoneId);
  }

  async function control(zoneId: number, body: object) {
    setBusyZone(zoneId);
    setControlError(null);
    try {
      const res = await fetch(`/api/audio/zones/${zoneId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Ein abgelehnter Befehl blieb sonst unsichtbar – die Zone tat einfach nichts.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setControlError({
          zoneId,
          message: typeof data.error === "string" ? data.error : "Befehl fehlgeschlagen",
        });
      }
      refresh();
    } finally {
      setBusyZone(null);
    }
  }

  /**
   * Bluetooth-Kopplung für fünf Minuten freigeben oder vorzeitig schließen.
   * Außerhalb des Fensters ist die Zone nicht sichtbar; bereits gekoppelte
   * Geräte kommen weiterhin durch.
   */
  async function togglePairing(zoneId: number, open: boolean) {
    setBusyZone(zoneId);
    setControlError(null);
    try {
      const res = await fetch(`/api/audio/zones/${zoneId}/pairing`, {
        method: open ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setControlError({
          zoneId,
          message: typeof data.error === "string" ? data.error : "Kopplung fehlgeschlagen",
        });
      }
      refresh();
    } finally {
      setBusyZone(null);
    }
  }

  async function toggleSchedule(schedule: ScheduleRow) {
    await fetch(`/api/audio/schedules/${schedule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !schedule.isActive }),
    });
    refresh();
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const paths = {
      zone: "zones",
      playlist: "playlists",
      stream: "streams",
      announcement: "announcements",
      schedule: "schedules",
    } as const;
    await fetch(`/api/audio/${paths[deleteConfirm.kind]}/${deleteConfirm.id}`, {
      method: "DELETE",
    });
    // Eine gelöschte Zone soll nicht weiter im Ohr bleiben.
    if (deleteConfirm.kind === "zone" && monitor.zoneId === deleteConfirm.id) monitor.stop();
    setDeleteConfirm(null);
    refresh();
  }

  return (
    <div className="max-w-6xl">
      <ZoneStatusBar zones={zones} status={liveZones} onSelect={showZone} />

      <Tabs value={tab} onValueChange={setTab}>
        {/*
          Die Zähler bleiben dem Zeigergerät vorbehalten, sonst sieht man am
          Telefon kaum zwei Tabs.
        */}
        <TabsList className="mb-4 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="announce" className="flex-none gap-1.5">
            <Megaphone className="h-4 w-4" />
            Durchsage
          </TabsTrigger>
          <TabsTrigger value="zones" className="flex-none gap-1.5">
            <Speaker className="h-4 w-4" />
            Zonen
            <TabCount value={zones.length} />
          </TabsTrigger>
          <TabsTrigger value="library" className="flex-none gap-1.5">
            <Music className="h-4 w-4" />
            Mediathek
            <TabCount value={tracks.length} />
          </TabsTrigger>
          <TabsTrigger value="playlists" className="flex-none gap-1.5">
            <ListMusic className="h-4 w-4" />
            Playlists
            <TabCount value={playlists.length} />
          </TabsTrigger>
          <TabsTrigger value="streams" className="flex-none gap-1.5">
            <Radio className="h-4 w-4" />
            Webradio
            <TabCount value={streams.length} />
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex-none gap-1.5">
            <Megaphone className="h-4 w-4" />
            Vorlagen
            <TabCount value={templates.length} />
          </TabsTrigger>
          <TabsTrigger value="schedules" className="flex-none gap-1.5">
            <CalendarClock className="h-4 w-4" />
            Zeitpläne
            <TabCount value={schedules.length} />
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-none gap-1.5">
            <History className="h-4 w-4" />
            Verlauf
          </TabsTrigger>
        </TabsList>

        {/* ── DURCHSAGE ────────────────────────────────────────────────────── */}
        <TabsContent value="announce">
          <AnnouncePanel
            zones={zones}
            templates={templates}
            onDone={refresh}
            voices={ttsVoices}
          />
        </TabsContent>

        {/* ── ZONEN ────────────────────────────────────────────────────────── */}
        <TabsContent value="zones" className="space-y-3">
          <SectionHeader
            text="Jede Zone ist ein Abspieler mit eigenem Verstärker."
            actionLabel="Neue Zone"
            onAction={() => setZoneDialog({ open: true, zone: null })}
          />

          {zones.length === 0 ? (
            <EmptyState
              icon={Speaker}
              title="Noch keine Zone"
              text="Lege eine Beschallungszone an und ordne ihr einen Abspieler zu."
            />
          ) : (
            <div className="grid gap-3">
              {zones.map((zone) => (
                <ZoneCard
                  key={zone.id}
                  zone={zone}
                  live={liveZones.get(zone.id)}
                  highlight={highlightZone === zone.id}
                  busy={busyZone === zone.id}
                  error={
                    controlError?.zoneId === zone.id
                      ? controlError.message
                      : monitor.error?.zoneId === zone.id
                        ? monitor.error.message
                        : null
                  }
                  monitor={{
                    active: monitor.zoneId === zone.id,
                    available: monitor.canMonitor(zone, takeoverOf(zone)),
                    title: monitor.title,
                    volume: monitor.volume,
                    toggle: () =>
                      monitor.toggle(
                        zone,
                        liveZones.get(zone.id)?.currentTitle ?? zone.currentTitle,
                        takeoverOf(zone)
                      ),
                    setVolume: monitor.setVolume,
                  }}
                  onPlay={() => control(zone.id, { action: "PLAY" })}
                  onStop={() => control(zone.id, { action: "STOP" })}
                  onVolume={(volume) => control(zone.id, { action: "VOLUME", volume })}
                  onSync={() => control(zone.id, { action: "SYNC_LIBRARY" })}
                  onPairing={(open) => togglePairing(zone.id, open)}
                  onEdit={() => setZoneDialog({ open: true, zone })}
                  onDelete={() =>
                    setDeleteConfirm({ kind: "zone", id: zone.id, name: zone.name })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── MEDIATHEK ────────────────────────────────────────────────────── */}
        <TabsContent value="library">
          <LibraryPanel tracks={tracks} onChanged={refresh} />
        </TabsContent>

        {/* ── PLAYLISTS ────────────────────────────────────────────────────── */}
        <TabsContent value="playlists" className="space-y-3">
          <SectionHeader
            text="Playlists laufen als Hintergrundmusik in den Zonen."
            actionLabel="Neue Playlist"
            onAction={() => setPlaylistDialog({ open: true, playlist: null })}
          />

          {playlists.length === 0 ? (
            <EmptyState
              icon={ListMusic}
              title="Noch keine Playlist"
              text="Stelle aus der Mediathek eine Titelliste für den laufenden Betrieb zusammen."
            />
          ) : (
            <div className="grid gap-3">
              {playlists.map((playlist) => (
                <Card key={playlist.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">
                          {playlist.name}
                        </h3>
                        <Badge variant="secondary" className="text-xs">
                          {playlist.trackIds.length} Titel
                        </Badge>
                        {playlist.shuffle && (
                          <Badge variant="outline" className="text-xs">
                            Zufall
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {playlist.description ? `${playlist.description} · ` : ""}
                        Gesamtlänge {formatDuration(playlist.totalSec || null)}
                        {playlist.crossfadeSec > 0 && ` · ${playlist.crossfadeSec}s Überblendung`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <IconAction
                        icon={Pencil}
                        label={`Playlist ${playlist.name} bearbeiten`}
                        title="Bearbeiten"
                        onClick={() => setPlaylistDialog({ open: true, playlist })}
                      />
                      <IconAction
                        icon={Trash2}
                        label={`Playlist ${playlist.name} löschen`}
                        title="Löschen"
                        tone="danger"
                        onClick={() =>
                          setDeleteConfirm({
                            kind: "playlist",
                            id: playlist.id,
                            name: playlist.name,
                          })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── WEBRADIO ─────────────────────────────────────────────────────── */}
        <TabsContent value="streams" className="space-y-3">
          <SectionHeader
            text="Sender einmal anlegen und in den Zonen auswählen."
            actionLabel="Neuer Sender"
            onAction={() => setStreamDialog({ open: true, stream: null })}
          />

          {streams.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="Noch kein Webradio"
              text="Lege Sender mit Namen und Stream-URL an. In der Zone wählst du sie dann aus der Liste."
            />
          ) : (
            <div className="grid gap-3">
              {streams.map((stream) => (
                <Card key={stream.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground">
                        {stream.name}
                      </h3>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{stream.url}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <IconAction
                        icon={Pencil}
                        label={`Sender ${stream.name} bearbeiten`}
                        title="Bearbeiten"
                        onClick={() => setStreamDialog({ open: true, stream })}
                      />
                      <IconAction
                        icon={Trash2}
                        label={`Sender ${stream.name} löschen`}
                        title="Löschen"
                        tone="danger"
                        onClick={() =>
                          setDeleteConfirm({
                            kind: "stream",
                            id: stream.id,
                            name: stream.name,
                          })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="templates" className="space-y-3">
          <SectionHeader
            text="Gespeicherte Durchsagen stehen als Schnellwahl und in Zeitplänen zur Verfügung."
            actionLabel="Neue Durchsage"
            onAction={() => setAnnouncementDialog({ open: true, announcement: null })}
          />

          {templates.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Noch keine gespeicherte Durchsage"
              text="Lege wiederkehrende Ansagen wie Betriebsschluss oder Kursbeginn einmal an."
            />
          ) : (
            <div className="grid gap-3">
              {templates.map((template) => (
                <Card key={template.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">
                          {template.name}
                        </h3>
                        {template.priority >= 100 && (
                          <Badge variant="danger" className="text-xs">
                            Notfall
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {template.source === "TTS" ? "Sprachausgabe" : "Audiodatei"}
                        </Badge>
                        {template.repeatCount > 1 && (
                          <Badge variant="outline" className="text-xs">
                            {template.repeatCount}×
                          </Badge>
                        )}
                      </div>
                      {template.text && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.text}</p>
                      )}
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {template.zoneIds.length === 0
                          ? "Alle aktiven Zonen"
                          : `${template.zoneIds.length} Zone${template.zoneIds.length === 1 ? "" : "n"}`}
                        {template.lastPlayedAt &&
                          ` · zuletzt ${new Date(template.lastPlayedAt).toLocaleString("de-DE", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <IconAction
                        icon={Pencil}
                        label={`Durchsage ${template.name} bearbeiten`}
                        title="Bearbeiten"
                        onClick={() => setAnnouncementDialog({ open: true, announcement: template })}
                      />
                      <IconAction
                        icon={Trash2}
                        label={`Durchsage ${template.name} löschen`}
                        title="Löschen"
                        tone="danger"
                        onClick={() =>
                          setDeleteConfirm({
                            kind: "announcement",
                            id: template.id,
                            name: template.name,
                          })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── ZEITPLÄNE ────────────────────────────────────────────────────── */}
        <TabsContent value="schedules" className="space-y-3">
          <SectionHeader
            text="Zeitpläne werden jede Minute geprüft."
            actionLabel="Neuer Zeitplan"
            onAction={() => setScheduleDialog({ open: true, schedule: null })}
          />

          {schedules.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Noch kein Zeitplan"
              text="Musik zum Betriebsbeginn, Durchsagen vor Betriebsende, Kursansagen zur Uhrzeit."
            />
          ) : (
            <div className="grid gap-3">
              {schedules.map((schedule) => (
                <Card key={schedule.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3
                          className={cn(
                            "font-semibold",
                            schedule.isActive
                              ? "text-foreground"
                              : "text-muted-foreground/70 line-through"
                          )}
                        >
                          {schedule.name}
                        </h3>
                        <Badge variant="secondary" className="text-xs">
                          {describeScheduleTiming(schedule)}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {formatDaysOfWeek(schedule.daysOfWeek)}
                        </Badge>
                        {schedule.operating !== "ANY" && (
                          <Badge variant="outline" className="text-xs">
                            {AUDIO_OPERATING_LABELS[schedule.operating]}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {ACTION_LABELS[schedule.action]}
                        {schedule.announcementName && `: ${schedule.announcementName}`}
                        {schedule.playlistName && `: ${schedule.playlistName}`}
                        {schedule.volume != null && `: ${schedule.volume}%`}
                        {" · "}
                        {schedule.zoneIds.length === 0
                          ? "alle Zonen"
                          : `${schedule.zoneIds.length} Zone${schedule.zoneIds.length === 1 ? "" : "n"}`}
                        {schedule.trigger !== "TIME" &&
                          ` · Betriebszeit: ${schedule.operatingScheduleName ?? "die des Raums"}`}
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">
                        {schedule.isActive
                          ? nextRunLabel(schedule, zones, operatingSchedules, timeZone)
                          : "Abgeschaltet"}
                        {" · "}
                        {schedule.lastRunAt
                          ? `zuletzt ${formatRelativeTime(schedule.lastRunAt) ?? "–"}`
                          : "noch nie ausgeführt"}
                      </p>
                      {schedule.isActive &&
                        scheduleWarnings(
                          schedule,
                          zones,
                          playlists,
                          announcements,
                          operatingSchedules,
                          timeZone
                        ).map(
                          (warning) => (
                            <p
                              key={warning}
                              className="mt-1.5 flex items-start gap-1.5 text-xs text-warning"
                            >
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                              <span>{warning}</span>
                            </p>
                          )
                        )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <IconAction
                        icon={schedule.isActive ? CheckCircle2 : XCircle}
                        iconClassName={
                          schedule.isActive ? "text-success" : "text-muted-foreground/70"
                        }
                        label={`Zeitplan ${schedule.name} ${schedule.isActive ? "deaktivieren" : "aktivieren"}`}
                        title={schedule.isActive ? "Deaktivieren" : "Aktivieren"}
                        pressed={schedule.isActive}
                        onClick={() => toggleSchedule(schedule)}
                      />
                      <IconAction
                        icon={Pencil}
                        label={`Zeitplan ${schedule.name} bearbeiten`}
                        title="Bearbeiten"
                        onClick={() => setScheduleDialog({ open: true, schedule })}
                      />
                      <IconAction
                        icon={Trash2}
                        label={`Zeitplan ${schedule.name} löschen`}
                        title="Löschen"
                        tone="danger"
                        onClick={() =>
                          setDeleteConfirm({
                            kind: "schedule",
                            id: schedule.id,
                            name: schedule.name,
                          })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── VERLAUF ──────────────────────────────────────────────────────── */}
        <TabsContent value="history">
          <HistoryPanel jobs={historyJobs} />
        </TabsContent>
      </Tabs>

      {/* Ein Element für alle Zonen – so überlagern sich zwei Zonen nie. */}
      <audio
        ref={monitor.audioRef}
        onEnded={monitor.onEnded}
        onError={monitor.onError}
        className="hidden"
      />

      {zoneDialog.open && (
        <ZoneDialog
          open
          zone={zoneDialog.zone}
          devices={audioDevices}
          playlists={playlists}
          streams={streams}
          rooms={rooms}
          operatingSchedules={operatingSchedules}
          timeZone={timeZone}
          onClose={() => setZoneDialog({ open: false, zone: null })}
          onSaved={() => {
            setZoneDialog({ open: false, zone: null });
            refresh();
          }}
        />
      )}

      {playlistDialog.open && (
        <PlaylistDialog
          open
          playlist={playlistDialog.playlist}
          tracks={tracks}
          onClose={() => setPlaylistDialog({ open: false, playlist: null })}
          onSaved={() => {
            setPlaylistDialog({ open: false, playlist: null });
            refresh();
          }}
        />
      )}

      {streamDialog.open && (
        <StreamDialog
          open
          stream={streamDialog.stream}
          onClose={() => setStreamDialog({ open: false, stream: null })}
          onSaved={() => {
            setStreamDialog({ open: false, stream: null });
            refresh();
          }}
        />
      )}

      {announcementDialog.open && (
        <AnnouncementDialog
          open
          announcement={announcementDialog.announcement}
          zones={zones}
          tracks={tracks}
          voices={ttsVoices}
          onClose={() => setAnnouncementDialog({ open: false, announcement: null })}
          onSaved={() => {
            setAnnouncementDialog({ open: false, announcement: null });
            refresh();
          }}
        />
      )}

      {scheduleDialog.open && (
        <ScheduleDialog
          open
          schedule={scheduleDialog.schedule}
          zones={zones}
          playlists={playlists}
          announcements={announcements}
          operatingSchedules={operatingSchedules}
          onClose={() => setScheduleDialog({ open: false, schedule: null })}
          onSaved={() => {
            setScheduleDialog({ open: false, schedule: null });
            refresh();
          }}
        />
      )}

      <AlertDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{deleteConfirm?.name}&ldquo; löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Das lässt sich nicht rückgängig machen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Kopfzeile eines Tabs: Erklärung links, Anlegen-Knopf rechts.
 *
 * Nebeneinander wurde der Knopf am Telefon vom Erklärtext zusammengequetscht.
 * Untereinander nimmt er die ganze Breite und ist mit dem Daumen zu treffen.
 */
function SectionHeader({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button onClick={onAction} className="w-full gap-1.5 sm:w-auto sm:shrink-0">
        <Plus className="h-4 w-4" /> {actionLabel}
      </Button>
    </div>
  );
}

function TabCount({ value }: { value: number }) {
  return (
    <Badge variant="secondary" className="ml-1.5 hidden text-xs sm:inline-flex">
      {value}
    </Badge>
  );
}

/**
 * Icon-Knopf am Rand einer Karte.
 *
 * Mit `size="sm"` waren das 32 px – am Telefon zu wenig, erst recht bei vier
 * Knöpfen in einer Reihe an einer Zonenkarte. Am Zeigergerät bleibt es kompakt,
 * dort ist die Trefferfläche kein Thema.
 */
function IconAction({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  pressed,
  tone,
  className,
  iconClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  tone?: "danger";
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={cn(
        "h-10 w-10 sm:h-8 sm:w-8",
        tone === "danger" && "text-destructive hover:bg-destructive/10 ",
        className
      )}
    >
      <Icon className={cn("h-4 w-4", iconClassName)} />
    </Button>
  );
}

function ZoneCard({
  zone,
  live,
  highlight,
  busy,
  error,
  monitor,
  onPlay,
  onStop,
  onVolume,
  onSync,
  onPairing,
  onEdit,
  onDelete,
}: {
  zone: ZoneRow;
  live: ZoneStatus | undefined;
  highlight: boolean;
  busy: boolean;
  error: string | null;
  monitor: {
    active: boolean;
    available: boolean;
    title: string | null;
    volume: number;
    toggle: () => void;
    setVolume: (volume: number) => void;
  };
  onPlay: () => void;
  onStop: () => void;
  onVolume: (volume: number) => void;
  onSync: () => void;
  onPairing: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const serverVolume = live?.volume ?? zone.volume;
  const isPlaying = live?.isPlaying ?? zone.isPlaying;
  const deviceOnline = live?.deviceOnline ?? zone.deviceOnline;
  const currentTitle = live?.currentTitle ?? zone.currentTitle;
  const pendingJobs = live?.pendingJobs ?? 0;
  // Der Livewert ist auch dann maßgeblich, wenn er null ist: eine gerade
  // beendete Übernahme darf nicht als laufend stehen bleiben.
  const externalActive = live ? live.externalActive : zone.externalActive;
  const externalSender = live ? live.externalSender : zone.externalSender;
  const pairableFor = live?.pairableFor ?? zone.pairableFor;

  const cardRef = useRef<HTMLDivElement>(null);
  const volume = useCommittedVolume(serverVolume, onVolume);
  const pairable = usePairingCountdown(pairableFor);

  // Beim Webradio hört man dasselbe Programm; eine Playlist beginnt dagegen
  // beim gemeldeten Titel von vorn, weil der Pi keine Position meldet.
  const monitorHint =
    zoneSource(zone) === "STREAM"
      ? "derselbe Stream auf diesem Gerät"
      : "dieselbe Playlist auf diesem Gerät, nicht taktgleich";

  useEffect(() => {
    if (highlight) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);

  const lastSeen = formatRelativeTime(live?.lastStateAt ?? zone.lastStateAt);
  const musicWindow = describeMusicWindow(zone);

  return (
    <Card
      ref={cardRef}
      className={cn(
        "border-border transition-shadow dark:border-border",
        !zone.isActive && "opacity-60",
        highlight && "ring-2 ring-primary"
      )}>
      <CardContent className="p-4">
        {/*
          Am Telefon stehen die Knöpfe unter dem Namen: nebeneinander blieben
          für den Zonennamen neben vier Knöpfen nur wenige Zeichen.
        */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground">{zone.name}</h3>
              {zone.deviceId ? (
                <Badge
                  className={cn(
                    "text-xs",
                    deviceOnline
                      ? "bg-success/12 text-success"
                      : "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground"
                  )}
                >
                  {deviceOnline ? "Online" : "Offline"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  Kein Abspieler
                </Badge>
              )}
              {zone.roomName && (
                <Badge variant="outline" className="text-xs" title="Raum – über ihn erbt die Zone die Betriebszeit">
                  {zone.roomName}
                </Badge>
              )}
              {zone.syncGroup && (
                <Badge variant="outline" className="text-xs">
                  Sync: {zone.syncGroup}
                </Badge>
              )}
              {isPlaying && (
                <Badge className="bg-primary/10 text-primary text-xs gap-1">
                  <Volume2 className="h-3 w-3" /> läuft
                </Badge>
              )}
              {externalActive && (
                <Badge className="gap-1 bg-info/10 text-xs text-info">
                  {externalActive === "AIRPLAY" ? (
                    <Airplay className="h-3 w-3" />
                  ) : (
                    <Bluetooth className="h-3 w-3" />
                  )}
                  {EXTERNAL_LABELS[externalActive]}
                  {externalSender && ` · ${externalSender}`}
                </Badge>
              )}
              {pendingJobs > 0 && (
                <Badge
                  variant="outline"
                  className="gap-1 border-warning/30 text-xs text-warning"
                >
                  <Clock className="h-3 w-3" />
                  {pendingJobs} wartet
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-1">
              {currentTitle ??
                (zone.sourceKind === "PLAYLIST"
                  ? (zone.playlistName ?? "Playlist")
                  : zone.sourceKind === "STREAM"
                    ? (zone.streamName ?? "Webradio")
                    : "Keine Wiedergabe")}
              {musicWindow && ` · ${musicWindow}`}
              {lastSeen && ` · gemeldet ${lastSeen}`}
            </p>
          </div>

          <div className="-mr-1 flex shrink-0 justify-end gap-1 sm:mr-0">
            <IconAction
              icon={Headphones}
              label={
                monitor.active
                  ? `Mithören von ${zone.name} beenden`
                  : `Zone ${zone.name} auf diesem Gerät mithören`
              }
              title={
                externalActive
                  ? "Während einer Übernahme nicht möglich"
                  : monitor.available
                    ? `Mithören – ${monitorHint}`
                    : "Keine Quelle zum Mithören hinterlegt"
              }
              disabled={!monitor.available}
              pressed={monitor.active}
              onClick={monitor.toggle}
              className={cn(
                monitor.active &&
                  "text-primary bg-primary/10 hover:bg-primary/10 "
              )}
            />
            <IconAction
              icon={RefreshCw}
              label={`Dateicache von ${zone.name} abgleichen`}
              title="Dateicache abgleichen"
              onClick={onSync}
            />
            <IconAction
              icon={Pencil}
              label={`Zone ${zone.name} bearbeiten`}
              title="Bearbeiten"
              onClick={onEdit}
            />
            <IconAction
              icon={Trash2}
              label={`Zone ${zone.name} löschen`}
              title="Löschen"
              tone="danger"
              onClick={onDelete}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Start und Stopp teilen sich am Telefon die Breite, der Regler
              bekommt darunter eine eigene Zeile – gequetscht daneben war er
              nicht zu bedienen. */}
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              onClick={onPlay}
              disabled={busy}
              className="h-10 flex-1 gap-1.5 sm:h-8 sm:flex-none"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Start
            </Button>
            <Button
              variant="outline"
              onClick={onStop}
              disabled={busy}
              className="h-10 flex-1 gap-1.5 sm:h-8 sm:flex-none"
            >
              <Square className="h-3.5 w-3.5" />
              Stopp
            </Button>
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto sm:min-w-[180px] sm:flex-1">
            <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground/70" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume.value}
              onChange={(e) => volume.change(Number(e.target.value))}
              aria-label={`Lautstärke ${zone.name}`}
              aria-valuetext={`${volume.value} Prozent`}
              style={sliderFill(volume.value)}
              className="touch-slider flex-1"
            />
            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
              {volume.value}%
            </span>
          </div>
        </div>

        {externalActive && (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
            {externalActive === "AIRPLAY" ? (
              <Airplay className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <Bluetooth className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {externalSender
                ? `„${externalSender}“ sendet per ${EXTERNAL_LABELS[externalActive]}`
                : `Ein Gerät sendet per ${EXTERNAL_LABELS[externalActive]}`}
              . Die eigene Quelle läuft weiter, sobald die Verbindung endet – Durchsagen
              kommen auch währenddessen durch.
            </span>
          </p>
        )}

        {zone.bluetoothEnabled && (
          <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <Button
              variant="outline"
              onClick={() => onPairing(pairable === 0)}
              disabled={busy}
              className="h-10 shrink-0 gap-1.5 text-xs sm:h-8"
            >
              <BluetoothSearching className="h-3.5 w-3.5" />
              {pairable > 0
                ? `Kopplung offen – ${formatCountdown(pairable)}`
                : "Bluetooth-Kopplung freigeben"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {pairable > 0
                ? "Zone ist am Handy sichtbar. Nochmal drücken beendet die Freigabe vorzeitig."
                : "Bekannte Geräte verbinden sich jederzeit, neue nur im Fenster (5 Min)."}
            </span>
          </div>
        )}

        {monitor.active && (
          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Headphones className="h-3.5 w-3.5" />
              Mithören
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {monitor.title ? `${monitor.title} · ` : ""}
              {monitorHint}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={monitor.volume}
                onChange={(e) => monitor.setVolume(Number(e.target.value))}
                aria-label={`Mithör-Lautstärke ${zone.name}`}
                aria-valuetext={`${monitor.volume} Prozent`}
                style={sliderFill(monitor.volume)}
                className="touch-slider flex-1 sm:w-24 sm:flex-none"
              />
              <Button
                variant="ghost"
                onClick={monitor.toggle}
                className="h-10 shrink-0 text-xs sm:h-8"
              >
                Beenden
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Restlaufzeit des Kopplungsfensters, sekündlich herunterzählend.
 *
 * Der Serverwert kommt nur mit der Statusabfrage alle acht Sekunden – ohne
 * eigenen Takt sprang die Anzeige in Achtersprüngen und sah kaputt aus.
 */
function usePairingCountdown(seconds: number): number {
  // `from` merkt sich, auf welchem Serverwert der Rest beruht: kommt ein neuer,
  // beginnt das Zählen dort von vorn. Eine Abweichung durch einen gebremsten
  // Timer im Hintergrund korrigiert sich damit von selbst.
  const [state, setState] = useState({ from: seconds, remaining: seconds });
  if (state.from !== seconds) setState({ from: seconds, remaining: seconds });

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(
      () =>
        setState((prev) =>
          prev.remaining <= 0 ? prev : { ...prev, remaining: prev.remaining - 1 }
        ),
      1000
    );
    return () => clearInterval(timer);
  }, [seconds]);

  return state.remaining;
}

/** Verzögerung, bis eine Reglerbewegung als abgeschlossen gilt. */
const VOLUME_COMMIT_MS = 400;

/**
 * Lautstärkeregler, der jede Eingabeart unterstützt.
 *
 * Vorher wurde nur bei `mouseup`/`touchend` gesendet – per Tastatur bedient
 * kam die Änderung nie am Abspieler an. Jetzt zählt der Wert selbst, kurz
 * entprellt, damit beim Ziehen nicht pro Pixel ein Befehl entsteht.
 *
 * Solange eine eigene Eingabe offen ist, hat sie Vorrang vor dem Serverwert.
 * Erst wenn der Server den gewünschten Wert bestätigt, folgt der Regler wieder
 * ihm – sonst würde er nach dem Loslassen kurz auf den alten Stand zurück-
 * springen, bis die nächste Statusabfrage durch ist.
 */
function useCommittedVolume(serverVolume: number, onCommit: (volume: number) => void) {
  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (pending !== null && pending === serverVolume) setPending(null);

  function change(next: number) {
    setPending(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next), VOLUME_COMMIT_MS);
  }

  return { value: pending ?? serverVolume, change };
}

type HistoryFilter = "all" | "announcements" | "problems";

const HISTORY_FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "Alles" },
  { value: "announcements", label: "Nur Durchsagen" },
  { value: "problems", label: "Nur Probleme" },
];

function HistoryPanel({ jobs }: { jobs: JobRow[] }) {
  const [filter, setFilter] = useState<HistoryFilter>("all");

  // Ein Hänger ist so gut wie ein Fehler: der Befehl kommt nicht mehr an.
  const problems = useMemo(
    () => jobs.filter((job) => job.status === "FAILED" || isJobStuck(job)),
    [jobs]
  );

  const visible = useMemo(() => {
    if (filter === "announcements") return jobs.filter((job) => job.kind === "ANNOUNCE");
    if (filter === "problems") return problems;
    return jobs;
  }, [jobs, filter, problems]);

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Noch nichts abgespielt"
        text="Hier erscheinen alle Durchsagen und Steuerbefehle der letzten Zeit."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {HISTORY_FILTERS.map((option) => (
            <Chip
              key={option.value}
              active={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
              {option.value === "problems" && problems.length > 0 && ` (${problems.length})`}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Aktualisiert sich automatisch</p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nichts gefunden"
          text="Für diesen Filter gibt es keine Einträge – bei „Nur Probleme“ ist das die gute Nachricht."
        />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border/60">
            {visible.map((job) => (
              <JobItem key={job.id} job={job} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function JobItem({ job }: { job: JobRow }) {
  const failed = job.status === "FAILED";
  const done = job.status === "DONE";
  const running = job.status === "PLAYING";
  const stuck = isJobStuck(job);
  const waiting = (job.status === "PENDING" || job.status === "SENT") && !stuck;

  return (
    <div className="flex items-start gap-3 p-3">
      <div
        className="mt-0.5 shrink-0"
        title={stuck ? "Kein Abspieler hat den Befehl geholt" : JOB_STATUS_LABELS[job.status]}
      >
        {failed ? (
          <XCircle className="h-4 w-4 text-destructive" />
        ) : done ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : running ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : stuck ? (
          <AlertTriangle className="h-4 w-4 text-warning" />
        ) : (
          <Clock className="h-4 w-4 text-warning" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">
            {job.announcementName ?? JOB_KIND_LABELS[job.kind]}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {job.zoneName}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {triggerLabel(job.triggerKind)}
          </Badge>
          {(waiting || running) && (
            <span className="text-xs text-muted-foreground">{JOB_STATUS_LABELS[job.status]}</span>
          )}
        </div>
        {/* Hänger und Fehlertext auf eigenen Zeilen: in der Kopfzeile mit den
            Abzeichen zusammen war am Telefon nur ein abgeschnittener Rest zu
            sehen – und genau dort steht, was fehlt. */}
        {stuck && (
          <p className="mt-0.5 text-xs text-warning">
            Hängt seit {formatRelativeTime(job.createdAt)?.replace("vor ", "") ?? "?"} – kein
            Abspieler hat ihn geholt
          </p>
        )}
        {job.errorMessage && (
          <p className="mt-0.5 text-xs break-words text-destructive">{job.errorMessage}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {new Date(job.createdAt).toLocaleString("de-DE", {
            dateStyle: "short",
            timeStyle: "medium",
          })}
        </p>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <Card className="border-dashed border-input">
      <CardContent className="py-10 text-center">
        <Icon className="h-10 w-10 mx-auto text-muted-foreground/70 mb-3" />
        <h3 className="font-semibold text-foreground/80">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{text}</p>
      </CardContent>
    </Card>
  );
}

