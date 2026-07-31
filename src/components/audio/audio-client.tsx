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
import {
  formatDaysOfWeek,
  nextScheduleRunLabel,
  type TtsVoice,
} from "@/lib/audio-constants";
import { scheduleWarnings } from "./schedule-warnings";
import { AnnouncePanel } from "./announce-panel";
import { Chip, sliderFill } from "./ui";
import { AnnouncementDialog } from "./announcement-dialog";
import { LibraryPanel } from "./library-panel";
import {
  JOB_KIND_LABELS,
  JOB_STATUS_LABELS,
  formatDuration,
  formatRelativeTime,
  isJobStuck,
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
  /** Zeitzone des Accounts – Zeitpläne gelten in ihr, nicht in der des Browsers. */
  timeZone: string;
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
        {/*
          Sieben Tabs passen auf kein Telefon. Gewickelt ergaben sie drei
          ungleich breite Reihen, weil sich die Auslöser die Breite teilen –
          darum eine Reihe zum Schieben, wie in der Netzwerkansicht. Die Zähler
          bleiben dem Zeigergerät vorbehalten, sonst sieht man am Telefon kaum
          zwei Tabs.
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

        {/* ── VORLAGEN ─────────────────────────────────────────────────────── */}
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
                      <p className="text-xs text-slate-400 mt-0.5">
                        {schedule.isActive
                          ? nextScheduleRunLabel(schedule, new Date(), timeZone) ??
                            "Kein Wochentag gewählt"
                          : "Abgeschaltet"}
                        {" · "}
                        {schedule.lastRunAt
                          ? `zuletzt ${formatRelativeTime(schedule.lastRunAt) ?? "–"}`
                          : "noch nie ausgeführt"}
                      </p>
                      {schedule.isActive &&
                        scheduleWarnings(schedule, zones, playlists, announcements).map(
                          (warning) => (
                            <p
                              key={warning}
                              className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
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
                          schedule.isActive ? "text-emerald-500" : "text-slate-400"
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
      <p className="text-sm text-slate-500">{text}</p>
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
        tone === "danger" && "text-red-600 hover:bg-red-50 dark:hover:bg-red-950",
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
        {/*
          Am Telefon stehen die Knöpfe unter dem Namen: nebeneinander blieben
          für den Zonennamen neben vier Knöpfen nur wenige Zeichen.
        */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
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

          <div className="-mr-1 flex shrink-0 justify-end gap-1 sm:mr-0">
            <IconAction
              icon={Headphones}
              label={
                monitor.active
                  ? `Mithören von ${zone.name} beenden`
                  : `Zone ${zone.name} auf diesem Gerät mithören`
              }
              title={
                monitor.available
                  ? `Mithören – ${monitorHint}`
                  : "Keine Quelle zum Mithören hinterlegt"
              }
              disabled={!monitor.available}
              pressed={monitor.active}
              onClick={monitor.toggle}
              className={cn(
                monitor.active &&
                  "text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:text-indigo-400 dark:bg-indigo-950/40"
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
            <Volume2 className="h-4 w-4 shrink-0 text-slate-400" />
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
            <span className="w-9 text-right text-xs tabular-nums text-slate-500">
              {volume.value}%
            </span>
          </div>
        </div>

        {monitor.active && (
          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 sm:flex-row sm:items-center sm:gap-3 dark:border-indigo-900/40 dark:bg-indigo-950/20">
            <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              <Headphones className="h-3.5 w-3.5" />
              Mithören
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-400">
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
  const stuck = isJobStuck(job);
  const waiting = (job.status === "PENDING" || job.status === "SENT") && !stuck;

  return (
    <div className="flex items-start gap-3 p-3">
      <div
        className="mt-0.5 shrink-0"
        title={stuck ? "Kein Abspieler hat den Befehl geholt" : JOB_STATUS_LABELS[job.status]}
      >
        {failed ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : done ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : running ? (
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
        ) : stuck ? (
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        ) : (
          <Clock className="h-4 w-4 text-amber-500" />
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
            <span className="text-xs text-slate-500">{JOB_STATUS_LABELS[job.status]}</span>
          )}
        </div>
        {/* Hänger und Fehlertext auf eigenen Zeilen: in der Kopfzeile mit den
            Abzeichen zusammen war am Telefon nur ein abgeschnittener Rest zu
            sehen – und genau dort steht, was fehlt. */}
        {stuck && (
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
            Hängt seit {formatRelativeTime(job.createdAt)?.replace("vor ", "") ?? "?"} – kein
            Abspieler hat ihn geholt
          </p>
        )}
        {job.errorMessage && (
          <p className="mt-0.5 text-xs break-words text-red-600">{job.errorMessage}</p>
        )}
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

