"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarClock,
  CheckCircle2,
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
import { formatDaysOfWeek } from "@/lib/audio-constants";
import { AnnouncePanel } from "./announce-panel";
import { AnnouncementDialog } from "./announcement-dialog";
import { LibraryPanel, formatDuration } from "./library-panel";
import { PlaylistDialog } from "./playlist-dialog";
import { ScheduleDialog, ACTION_LABELS } from "./schedule-dialog";
import { ZoneDialog } from "./zone-dialog";
import type {
  AnnouncementRow,
  AudioDeviceOption,
  JobRow,
  PlaylistRow,
  ScheduleRow,
  TrackRow,
  ZoneRow,
} from "./types";

interface Props {
  zones: ZoneRow[];
  tracks: TrackRow[];
  playlists: PlaylistRow[];
  announcements: AnnouncementRow[];
  schedules: ScheduleRow[];
  jobs: JobRow[];
  audioDevices: AudioDeviceOption[];
}

export function AudioClient({
  zones,
  tracks,
  playlists,
  announcements,
  schedules,
  jobs,
  audioDevices,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

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
  const [deleteConfirm, setDeleteConfirm] = useState<{
    kind: "zone" | "playlist" | "announcement" | "schedule";
    id: number;
    name: string;
  } | null>(null);

  const templates = announcements.filter((a) => a.isTemplate);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function control(zoneId: number, body: object) {
    setBusyZone(zoneId);
    try {
      await fetch(`/api/audio/zones/${zoneId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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
    setDeleteConfirm(null);
    refresh();
  }

  return (
    <div className="max-w-6xl">
      <Tabs defaultValue="announce">
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
          <AnnouncePanel zones={zones} templates={templates} onDone={refresh} />
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
                  busy={busyZone === zone.id}
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
          {jobs.length === 0 ? (
            <EmptyState
              icon={History}
              title="Noch nichts abgespielt"
              text="Hier erscheinen alle Durchsagen und Steuerbefehle der letzten Zeit."
            />
          ) : (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
                {jobs.map((job) => (
                  <JobItem key={job.id} job={job} />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

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

      {deleteConfirm && (
        <ConfirmDialog
          title={`„${deleteConfirm.name}" löschen?`}
          text="Das lässt sich nicht rückgängig machen."
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function ZoneCard({
  zone,
  busy,
  onPlay,
  onStop,
  onVolume,
  onSync,
  onEdit,
  onDelete,
}: {
  zone: ZoneRow;
  busy: boolean;
  onPlay: () => void;
  onStop: () => void;
  onVolume: (volume: number) => void;
  onSync: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [volume, setVolume] = useState(zone.volume);

  return (
    <Card className={cn("border-slate-200 dark:border-slate-800", !zone.isActive && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{zone.name}</h3>
              {zone.deviceId ? (
                <Badge
                  className={cn(
                    "text-xs",
                    zone.deviceOnline
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  )}
                >
                  {zone.deviceOnline ? "Online" : "Offline"}
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
              {zone.isPlaying && (
                <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs gap-1">
                  <Volume2 className="h-3 w-3" /> läuft
                </Badge>
              )}
            </div>

            <p className="text-xs text-slate-500 mt-1">
              {zone.currentTitle ??
                (zone.sourceKind === "PLAYLIST"
                  ? (zone.playlistName ?? "Playlist")
                  : zone.sourceKind === "STREAM"
                    ? "Webradio"
                    : "Keine Wiedergabe")}
              {zone.quietFrom && zone.quietTo && ` · Ruhe ${zone.quietFrom}–${zone.quietTo}`}
            </p>
          </div>

          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onSync} title="Dateicache abgleichen">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <Button size="sm" onClick={onPlay} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start
          </Button>
          <Button size="sm" variant="outline" onClick={onStop} disabled={busy} className="gap-1.5">
            <Square className="h-3.5 w-3.5" />
            Stopp
          </Button>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Volume2 className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              onMouseUp={() => onVolume(volume)}
              onTouchEnd={() => onVolume(volume)}
              className="flex-1 accent-indigo-600"
            />
            <span className="text-xs text-slate-500 w-9 text-right">{volume}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function JobItem({ job }: { job: JobRow }) {
  const failed = job.status === "FAILED";
  const done = job.status === "DONE";

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="shrink-0">
        {failed ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : done ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <Loader2 className="h-4 w-4 text-slate-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {job.announcementName ?? job.kind}
          </span>
          <Badge variant="outline" className="text-[10px] uppercase">
            {job.zoneName}
          </Badge>
          <Badge variant="secondary" className="text-[10px] uppercase">
            {job.triggerKind}
          </Badge>
          {job.errorMessage && (
            <span className="text-xs text-red-600 truncate">{job.errorMessage}</span>
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

function ConfirmDialog({
  title,
  text,
  onCancel,
  onConfirm,
}: {
  title: string;
  text: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-sm border-slate-200 dark:border-slate-800">
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="text-sm text-slate-500 mt-1">{text}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Abbrechen
            </Button>
            <Button size="sm" onClick={onConfirm} className="bg-red-600 hover:bg-red-700 text-white">
              Löschen
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
