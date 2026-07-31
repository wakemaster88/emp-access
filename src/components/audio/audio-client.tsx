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
  AlertTriangle,
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
  RefreshCw,
  Speaker,
  Square,
  Trash2,
  Volume2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDaysOfWeek, type TtsVoice } from "@/lib/audio-constants";
import { AnnouncePanel } from "./announce-panel";
import { AnnouncementDialog } from "./announcement-dialog";
import { LibraryPanel } from "./library-panel";
import {
  JOB_KIND_LABELS,
  JOB_STATUS_LABELS,
  formatDuration,
  formatRelativeTime,
  triggerLabel,
} from "./labels";
import { PlaylistDialog } from "./playlist-dialog";
import { ScheduleDialog, ACTION_LABELS } from "./schedule-dialog";
import { useAudioStatus } from "./use-audio-status";
import { useZoneMonitor, zoneSource } from "./use-zone-monitor";
import { ZoneDialog } from "./zone-dialog";
import { ZoneStatusBar } from "./zone-status-bar";
import type {
  AnnouncementRow,
  AudioDeviceOption,
  JobRow,
  PlaylistRow,
  ScheduleRow,
  TrackRow,
  ZoneRow,
  ZoneStatus,
} from "./types";

interface Props {
  zones: ZoneRow[];
  tracks: TrackRow[];
  playlists: PlaylistRow[];
  announcements: AnnouncementRow[];
  schedules: ScheduleRow[];
  jobs: JobRow[];
  audioDevices: AudioDeviceOption[];
  ttsVoices: TtsVoice[];
}

export function AudioClient({
  zones,
  tracks,
  playlists,
  announcements,
  schedules,
  jobs,
  audioDevices,
  ttsVoices,
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
    kind: "zone" | "playlist" | "announcement" | "schedule";
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
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="announce" className="gap-1.5">
            <Megaphone className="h-4 w-4" />
            Durchsage
          </TabsTrigger>
          <TabsTrigger value="zones" className="gap-1.5">
            <Speaker className="h-4 w-4" />
            Zonen
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {zones.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="library" className="gap-1.5">
            <Music className="h-4 w-4" />
            Mediathek
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {tracks.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="playlists" className="gap-1.5">
            <ListMusic className="h-4 w-4" />
            Playlists
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {playlists.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <Megaphone className="h-4 w-4" />
            Vorlagen
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {templates.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5">
            <CalendarClock className="h-4 w-4" />
            Zeitpläne
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {schedules.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Jede Zone ist ein Abspieler mit eigenem Verstärker.
            </p>
            <Button
              size="sm"
              onClick={() => setZoneDialog({ open: true, zone: null })}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> Neue Zone
            </Button>
          </div>

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
                    available: monitor.canMonitor(zone),
                    title: monitor.title,
                    volume: monitor.volume,
                    toggle: () =>
                      monitor.toggle(
                        zone,
                        liveZones.get(zone.id)?.currentTitle ?? zone.currentTitle
                      ),
                    setVolume: monitor.setVolume,
                  }}
                  onPlay={() => control(zone.id, { action: "PLAY" })}
                  onStop={() => control(zone.id, { action: "STOP" })}
                  onVolume={(volume) => control(zone.id, { action: "VOLUME", volume })}
                  onSync={() => control(zone.id, { action: "SYNC_LIBRARY" })}
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Playlists laufen als Hintergrundmusik in den Zonen.
            </p>
            <Button
              size="sm"
              onClick={() => setPlaylistDialog({ open: true, playlist: null })}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> Neue Playlist
            </Button>
          </div>

          {playlists.length === 0 ? (
            <EmptyState
              icon={ListMusic}
              title="Noch keine Playlist"
              text="Stelle aus der Mediathek eine Titelliste für den laufenden Betrieb zusammen."
            />
          ) : (
            <div className="grid gap-3">
              {playlists.map((playlist) => (
                <Card key={playlist.id} className="border-slate-200 dark:border-slate-800">
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
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
                      <p className="text-xs text-slate-500 mt-1">
                        {playlist.description ? `${playlist.description} · ` : ""}
                        Gesamtlänge {formatDuration(playlist.totalSec || null)}
                        {playlist.crossfadeSec > 0 && ` · ${playlist.crossfadeSec}s Überblendung`}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPlaylistDialog({ open: true, playlist })}
                        aria-label={`Playlist ${playlist.name} bearbeiten`}
                        title="Bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDeleteConfirm({
                            kind: "playlist",
                            id: playlist.id,
                            name: playlist.name,
                          })
                        }
                        aria-label={`Playlist ${playlist.name} löschen`}
                        title="Löschen"
                        className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── VORLAGEN ─────────────────────────────────────────────────────── */}
        <TabsContent value="templates" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Gespeicherte Durchsagen stehen als Schnellwahl und in Zeitplänen zur Verfügung.
            </p>
            <Button
              size="sm"
              onClick={() => setAnnouncementDialog({ open: true, announcement: null })}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> Neue Durchsage
            </Button>
          </div>

          {templates.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Noch keine gespeicherte Durchsage"
              text="Lege wiederkehrende Ansagen wie Betriebsschluss oder Kursbeginn einmal an."
            />
          ) : (
            <div className="grid gap-3">
              {templates.map((template) => (
                <Card key={template.id} className="border-slate-200 dark:border-slate-800">
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                          {template.name}
                        </h3>
                        {template.priority >= 100 && (
                          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs">
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
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{template.text}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-1">
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
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAnnouncementDialog({ open: true, announcement: template })}
                        aria-label={`Durchsage ${template.name} bearbeiten`}
                        title="Bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDeleteConfirm({
                            kind: "announcement",
                            id: template.id,
                            name: template.name,
                          })
                        }
                        aria-label={`Durchsage ${template.name} löschen`}
                        title="Löschen"
                        className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── ZEITPLÄNE ────────────────────────────────────────────────────── */}
        <TabsContent value="schedules" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Zeitpläne werden alle fünf Minuten geprüft.
            </p>
            <Button
              size="sm"
              onClick={() => setScheduleDialog({ open: true, schedule: null })}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> Neuer Zeitplan
            </Button>
          </div>

          {schedules.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Noch kein Zeitplan"
              text="Automatisiere Öffnungsmusik, Kursdurchsagen und Betriebsschluss."
            />
          ) : (
            <div className="grid gap-3">
              {schedules.map((schedule) => (
                <Card key={schedule.id} className="border-slate-200 dark:border-slate-800">
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3
                          className={cn(
                            "font-semibold",
                            schedule.isActive
                              ? "text-slate-900 dark:text-slate-100"
                              : "text-slate-400 line-through"
                          )}
                        >
                          {schedule.name}
                        </h3>
                        <Badge variant="secondary" className="text-xs">
                          {schedule.timeOfDay}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {formatDaysOfWeek(schedule.daysOfWeek)}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {ACTION_LABELS[schedule.action]}
                        {schedule.announcementName && `: ${schedule.announcementName}`}
                        {schedule.playlistName && `: ${schedule.playlistName}`}
                        {schedule.volume != null && `: ${schedule.volume}%`}
                        {" · "}
                        {schedule.zoneIds.length === 0
                          ? "alle Zonen"
                          : `${schedule.zoneIds.length} Zone${schedule.zoneIds.length === 1 ? "" : "n"}`}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSchedule(schedule)}
                        aria-label={`Zeitplan ${schedule.name} ${schedule.isActive ? "deaktivieren" : "aktivieren"}`}
                        title={schedule.isActive ? "Deaktivieren" : "Aktivieren"}
                      >
                        {schedule.isActive ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setScheduleDialog({ open: true, schedule })}
                        aria-label={`Zeitplan ${schedule.name} bearbeiten`}
                        title="Bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDeleteConfirm({
                            kind: "schedule",
                            id: schedule.id,
                            name: schedule.name,
                          })
                        }
                        aria-label={`Zeitplan ${schedule.name} löschen`}
                        title="Löschen"
                        className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
  onEdit: () => void;
  onDelete: () => void;
}) {
  const serverVolume = live?.volume ?? zone.volume;
  const isPlaying = live?.isPlaying ?? zone.isPlaying;
  const deviceOnline = live?.deviceOnline ?? zone.deviceOnline;
  const currentTitle = live?.currentTitle ?? zone.currentTitle;
  const pendingJobs = live?.pendingJobs ?? 0;

  const cardRef = useRef<HTMLDivElement>(null);
  const volume = useCommittedVolume(serverVolume, onVolume);

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

  return (
    <Card
      ref={cardRef}
      className={cn(
        "border-slate-200 transition-shadow dark:border-slate-800",
        !zone.isActive && "opacity-60",
        highlight && "ring-2 ring-indigo-500"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{zone.name}</h3>
              {zone.deviceId ? (
                <Badge
                  className={cn(
                    "text-xs",
                    deviceOnline
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  )}
                >
                  {deviceOnline ? "Online" : "Offline"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  Kein Abspieler
                </Badge>
              )}
              {zone.syncGroup && (
                <Badge variant="outline" className="text-xs">
                  Sync: {zone.syncGroup}
                </Badge>
              )}
              {isPlaying && (
                <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs gap-1">
                  <Volume2 className="h-3 w-3" /> läuft
                </Badge>
              )}
              {pendingJobs > 0 && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-300 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-500"
                >
                  <Clock className="h-3 w-3" />
                  {pendingJobs} wartet
                </Badge>
              )}
            </div>

            <p className="text-xs text-slate-500 mt-1">
              {currentTitle ??
                (zone.sourceKind === "PLAYLIST"
                  ? (zone.playlistName ?? "Playlist")
                  : zone.sourceKind === "STREAM"
                    ? "Webradio"
                    : "Keine Wiedergabe")}
              {zone.quietFrom && zone.quietTo && ` · Ruhe ${zone.quietFrom}–${zone.quietTo}`}
              {lastSeen && ` · gemeldet ${lastSeen}`}
            </p>
          </div>

          <div className="flex gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={monitor.toggle}
              disabled={!monitor.available}
              aria-label={
                monitor.active
                  ? `Mithören von ${zone.name} beenden`
                  : `Zone ${zone.name} auf diesem Gerät mithören`
              }
              aria-pressed={monitor.active}
              title={
                monitor.available
                  ? `Mithören – ${monitorHint}`
                  : "Keine Quelle zum Mithören hinterlegt"
              }
              className={cn(
                monitor.active &&
                  "text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:text-indigo-400 dark:bg-indigo-950/40"
              )}
            >
              <Headphones className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSync}
              aria-label={`Dateicache von ${zone.name} abgleichen`}
              title="Dateicache abgleichen"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              aria-label={`Zone ${zone.name} bearbeiten`}
              title="Bearbeiten"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              aria-label={`Zone ${zone.name} löschen`}
              title="Löschen"
              className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onPlay} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start
          </Button>
          <Button size="sm" variant="outline" onClick={onStop} disabled={busy} className="gap-1.5">
            <Square className="h-3.5 w-3.5" />
            Stopp
          </Button>

          <div className="flex min-w-[180px] flex-1 items-center gap-2">
            <Volume2 className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume.value}
              onChange={(e) => volume.change(Number(e.target.value))}
              aria-label={`Lautstärke ${zone.name}`}
              aria-valuetext={`${volume.value} Prozent`}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-9 text-right text-xs tabular-nums text-slate-500">
              {volume.value}%
            </span>
          </div>
        </div>

        {monitor.active && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 dark:border-indigo-900/40 dark:bg-indigo-950/20">
            <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              <Headphones className="h-3.5 w-3.5" />
              Mithören
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-400">
              {monitor.title ? `${monitor.title} · ` : ""}
              {monitorHint}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={monitor.volume}
              onChange={(e) => monitor.setVolume(Number(e.target.value))}
              aria-label={`Mithör-Lautstärke ${zone.name}`}
              aria-valuetext={`${monitor.volume} Prozent`}
              className="w-24 accent-indigo-600"
            />
            <Button variant="ghost" size="sm" onClick={monitor.toggle} className="text-xs">
              Beenden
            </Button>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
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

  const visible = useMemo(() => {
    if (filter === "announcements") return jobs.filter((job) => job.kind === "ANNOUNCE");
    if (filter === "problems") return jobs.filter((job) => job.status === "FAILED");
    return jobs;
  }, [jobs, filter]);

  const failures = jobs.filter((job) => job.status === "FAILED").length;

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
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={filter === option.value}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === option.value
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              {option.label}
              {option.value === "problems" && failures > 0 && ` (${failures})`}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">Aktualisiert sich automatisch</p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nichts gefunden"
          text="Für diesen Filter gibt es keine Einträge – bei „Nur Probleme“ ist das die gute Nachricht."
        />
      ) : (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
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
  const waiting = job.status === "PENDING" || job.status === "SENT";

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="shrink-0" title={JOB_STATUS_LABELS[job.status]}>
        {failed ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : done ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : running ? (
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
        ) : (
          <Clock className="h-4 w-4 text-amber-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
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
            <span className="text-xs text-slate-500">{JOB_STATUS_LABELS[job.status]}</span>
          )}
          {job.errorMessage && (
            <span className="truncate text-xs text-red-600">{job.errorMessage}</span>
          )}
        </div>
        <p className="text-xs text-slate-500">
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
    <Card className="border-dashed border-slate-300 dark:border-slate-700">
      <CardContent className="py-10 text-center">
        <Icon className="h-10 w-10 mx-auto text-slate-400 mb-3" />
        <h3 className="font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
        <p className="text-sm text-slate-500 mt-1">{text}</p>
      </CardContent>
    </Card>
  );
}

