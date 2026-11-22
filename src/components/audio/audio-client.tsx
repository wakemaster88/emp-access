"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { EmptyState as EmptyStateBlock } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconChip } from "@/components/ui/icon-chip";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Airplay,
  AlertTriangle,
  Bluetooth,
  BluetoothSearching,
  CalendarClock,
  CheckCircle2,
  Clock,
  FolderOpen,
  Headphones,
  History,
  ListMusic,
  Loader2,
  Megaphone,
  MoreHorizontal,
  Music,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  Speaker,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUDIO_OPERATING_LABELS,
  SCHEDULE_WINDOW_MINUTES,
  describeMusicState,
  describeMusicWindow,
  describeScheduleTiming,
  formatDaysOfWeek,
  nextScheduleRunLabel,
  type TtsVoice,
} from "@/lib/audio-constants";
import { describeOccurrence, nextOperatingOccurrence } from "@/lib/operating-hours";
import { scheduleOperatingSpecs, scheduleWarnings } from "./schedule-warnings";
import { AnnouncePanel } from "./announce-panel";
import { LiveBroadcastBanner } from "./live-broadcast";
import { useLiveBroadcast } from "./use-live-broadcast";
import { SectionHeader, sliderFill } from "./ui";
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
import { SoundwebPanel } from "./soundweb-panel";
import { StreamDialog } from "./stream-dialog";
import { ScheduleDialog, ACTION_LABELS } from "./schedule-dialog";
import { useAudioStatus } from "./use-audio-status";
import { useZoneMonitor, zoneSource } from "./use-zone-monitor";
import { useZoneCommands, type ZoneCommandState } from "./use-zone-commands";
import { ZoneDialog } from "./zone-dialog";
import { BirthdayAnnounceCard, type BirthdayAnnounceSetting } from "./birthday-announce-card";
import { ZoneStatusBar } from "./zone-status-bar";
import type {
  AnnouncementRow,
  AudioDeviceOption,
  JobRow,
  OperatingScheduleOption,
  PlaylistRow,
  RoomOption,
  ScheduleRow,
  SoundwebDeviceRow,
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
  /** BSS-Soundweb-Prozessoren mit ihren Reglern (Tab „Soundweb“). */
  soundwebDevices: SoundwebDeviceRow[];
  /** Meldet sich der lokale Hub? Er hält die Soundweb-Verbindungen. */
  hubOnline: boolean;
  /** Geburtstags-Ansage am Start-Drehkreuz (Reiter Zeitpläne). */
  birthdayAnnounce: BirthdayAnnounceSetting | null;
  /** Kunden-App eingeschaltet (Geburtsdaten kommen aus ihrem Profil). */
  riderAppEnabled: boolean;
  /** Reiter aus der Adresse (`?tab=zonen`), sonst „Durchsage“. */
  initialTab?: string;
  /** Bereich unter „Inhalte“ aus der Adresse (`?bereich=playlists`). */
  initialContentTab?: string;
}

type AudioTab = "announce" | "zones" | "schedules" | "content" | "soundweb" | "history";
type ContentTab = "library" | "playlists" | "streams" | "templates";

/** Deutsche Namen in der Adresse – so sind geteilte Links lesbar. */
const TAB_SLUGS: Record<AudioTab, string> = {
  announce: "durchsage",
  zones: "zonen",
  schedules: "zeitplaene",
  content: "inhalte",
  soundweb: "soundweb",
  history: "verlauf",
};

const CONTENT_SLUGS: Record<ContentTab, string> = {
  library: "mediathek",
  playlists: "playlists",
  streams: "webradio",
  templates: "vorlagen",
};

/**
 * Reiter aus der Adresse. Alte Reiter (Mediathek, Playlists …) waren früher
 * eigene Reiter – ein Link darauf landet jetzt im passenden Bereich der Inhalte.
 */
function parseTab(tab: string | undefined, bereich: string | undefined): { tab: AudioTab; content: ContentTab } {
  const content =
    (Object.entries(CONTENT_SLUGS).find(([, slug]) => slug === bereich || slug === tab)?.[0] as
      | ContentTab
      | undefined) ?? "library";
  const main = Object.entries(TAB_SLUGS).find(([, slug]) => slug === tab)?.[0] as AudioTab | undefined;
  if (main) return { tab: main, content };
  if (tab && Object.values(CONTENT_SLUGS).includes(tab)) return { tab: "content", content };
  return { tab: "announce", content };
}

/** Rückmeldung an einer Zonenkarte zu Lautstärke, Abgleich, Kopplung oder Mithören. */
interface ZoneNotice {
  zoneId: number;
  tone: "success" | "danger";
  message: string;
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
  soundwebDevices,
  hubOnline,
  birthdayAnnounce,
  riderAppEnabled,
  initialTab,
  initialContentTab,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [initial] = useState(() => parseTab(initialTab, initialContentTab));
  const [tab, setTabState] = useState<AudioTab>(initial.tab);
  const [contentTab, setContentTab] = useState<ContentTab>(initial.content);
  const [highlightZone, setHighlightZone] = useState<number | null>(null);

  /**
   * Reiter in der Adresse halten (`?tab=zonen`): Neu laden, Zurück und ein
   * geteilter Link landen dort, wo man war – vorher begann die Seite immer
   * bei „Durchsage“. `replaceState` statt Router: kein Neuladen der Seite.
   */
  function setTab(next: string, sub?: ContentTab) {
    const value = (TAB_SLUGS[next as AudioTab] ? next : "announce") as AudioTab;
    setTabState(value);
    if (sub) setContentTab(sub);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", TAB_SLUGS[value]);
    if (value === "content") url.searchParams.set("bereich", CONTENT_SLUGS[sub ?? contentTab]);
    else url.searchParams.delete("bereich");
    window.history.replaceState(window.history.state, "", url);
  }

  function showContent(next: string) {
    setTab("content", next as ContentTab);
  }

  const { zones: liveZones, jobs: liveJobs, refresh: refreshStatus } = useAudioStatus(true);
  const commands = useZoneCommands({ liveZones, liveJobs, refreshStatus });
  const monitor = useZoneMonitor({ tracks, playlists });
  const live = useLiveBroadcast();

  // Zonenstatus und Verlauf nachziehen, sobald eine Live-Durchsage beginnt oder
  // endet – sonst stünde dort bis zur nächsten Abfrage noch der alte Stand.
  const livePhase = live.phase;
  const previousLivePhase = useRef(livePhase);
  useEffect(() => {
    if (previousLivePhase.current === livePhase) return;
    previousLivePhase.current = livePhase;
    if (livePhase === "live" || livePhase === "idle") void refreshStatus();
  }, [livePhase, refreshStatus]);

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
  const [zoneNotice, setZoneNotice] = useState<ZoneNotice | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    kind: "zone" | "playlist" | "stream" | "announcement" | "schedule";
    id: number;
    name: string;
  } | null>(null);

  // Eine Erfolgsmeldung ist nach ein paar Sekunden erledigt, ein Fehler bleibt
  // stehen, bis die nächste Handlung an der Zone ihn ersetzt.
  useEffect(() => {
    if (zoneNotice?.tone !== "success") return;
    const timer = setTimeout(() => setZoneNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [zoneNotice]);

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

  /**
   * Lautstärke und Abgleich. Start und Stopp laufen über `commands`, weil sie
   * bis zur Bestätigung durch den Abspieler sichtbar offen bleiben.
   */
  async function control(
    zoneId: number,
    body: { action: "VOLUME"; volume: number } | { action: "SYNC_LIBRARY" },
    success?: string
  ) {
    setBusyZone(zoneId);
    if (zoneNotice?.zoneId === zoneId) setZoneNotice(null);
    try {
      const res = await fetch(`/api/audio/zones/${zoneId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Ein abgelehnter Befehl blieb sonst unsichtbar – die Zone tat einfach nichts.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setZoneNotice({
          zoneId,
          tone: "danger",
          message: typeof data.error === "string" ? data.error : "Befehl fehlgeschlagen",
        });
      } else if (success) {
        setZoneNotice({ zoneId, tone: "success", message: success });
      }
      refresh();
    } catch {
      setZoneNotice({
        zoneId,
        tone: "danger",
        message: "Keine Verbindung zum Server · Netz prüfen und erneut versuchen",
      });
    } finally {
      setBusyZone(null);
    }
  }

  async function startStop(zoneId: number, action: "PLAY" | "STOP") {
    if (zoneNotice?.zoneId === zoneId) setZoneNotice(null);
    await commands.send(zoneId, action);
    // Seite nachladen, damit „Musik manuell an bis …“ und die Quelle stimmen.
    startTransition(() => router.refresh());
  }

  /**
   * Bluetooth-Kopplung für fünf Minuten freigeben oder vorzeitig schließen.
   * Außerhalb des Fensters ist die Zone nicht sichtbar; bereits gekoppelte
   * Geräte kommen weiterhin durch.
   */
  async function togglePairing(zoneId: number, open: boolean) {
    setBusyZone(zoneId);
    if (zoneNotice?.zoneId === zoneId) setZoneNotice(null);
    try {
      const res = await fetch(`/api/audio/zones/${zoneId}/pairing`, {
        method: open ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setZoneNotice({
          zoneId,
          tone: "danger",
          message: typeof data.error === "string" ? data.error : "Kopplung fehlgeschlagen",
        });
      }
      refresh();
    } finally {
      setBusyZone(null);
    }
  }

  /**
   * Zeitplan an- oder abschalten. Der Schalter folgt sofort (wie iOS); kommt
   * die Änderung nicht an, springt er zurück und der Grund steht darunter.
   */
  const [scheduleOverride, setScheduleOverride] = useState<Map<number, boolean>>(new Map());
  const [scheduleError, setScheduleError] = useState<{ id: number; message: string } | null>(null);

  // Hat die Seite den neuen Stand geladen, gilt wieder der Serverwert.
  for (const [id, value] of scheduleOverride) {
    if (schedules.find((s) => s.id === id)?.isActive === value) {
      const next = new Map(scheduleOverride);
      next.delete(id);
      setScheduleOverride(next);
      break;
    }
  }

  async function toggleSchedule(schedule: ScheduleRow, isActive: boolean) {
    setScheduleError(null);
    setScheduleOverride((prev) => new Map(prev).set(schedule.id, isActive));
    let message: string | null = null;
    try {
      const res = await fetch(`/api/audio/schedules/${schedule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        message = typeof data.error === "string" ? data.error : "Änderung nicht gespeichert";
      }
    } catch {
      message = "Keine Verbindung zum Server · erneut versuchen";
    }
    if (message) {
      setScheduleOverride((prev) => {
        const next = new Map(prev);
        next.delete(schedule.id);
        return next;
      });
      setScheduleError({ id: schedule.id, message });
      return;
    }
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
    const res = await fetch(`/api/audio/${paths[deleteConfirm.kind]}/${deleteConfirm.id}`, {
      method: "DELETE",
    });
    // Ein Fehler bleibt im Dialog stehen (ConfirmDialog), statt dass der
    // Eintrag einfach weiter in der Liste auftaucht.
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "Löschen fehlgeschlagen");
    }
    // Eine gelöschte Zone soll nicht weiter im Ohr bleiben.
    if (deleteConfirm.kind === "zone" && monitor.zoneId === deleteConfirm.id) monitor.stop();
    refresh();
  }

  // Probleme im Verlauf (Fehler, Hänger) als Zahl am Reiter – Abschnitt 6
  // erlaubt dort genau eine Zahl für Störungen.
  const problemCount = useMemo(
    () => historyJobs.filter((job) => job.status === "FAILED" || isJobStuck(job)).length,
    [historyJobs]
  );

  return (
    <div className="max-w-6xl space-y-4 sm:space-y-5">
      {live.phase !== "idle" && tab !== "announce" && (
        <LiveBroadcastBanner live={live} onShow={() => setTab("announce")} />
      )}
      {/* Auf „Zonen“ stehen dieselben Angaben ausführlich in den Karten
          (Abschnitt 1: jede Information genau einmal). */}
      {tab !== "zones" && (
        <ZoneStatusBar zones={zones} status={liveZones} commands={commands.commands} onSelect={showZone} />
      )}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        {/*
          Sechs Reiter statt neun: Mediathek, Playlists, Webradio und Vorlagen
          sind alle „Inhalte“, die man einmal anlegt und dann in Zonen,
          Durchsagen und Zeitplänen auswählt – sie liegen jetzt gemeinsam einen
          Tipp tiefer. Im Betrieb braucht man vorn nur Durchsage, Zonen und den
          Verlauf. Die Leiste bricht um (Abschnitt 6); auf dem Handy füllen die
          Reiter jede Zeile (zwei Zeilen zu je drei bei 360 px), ab `sm` behalten
          sie ihre Breite. Einzige Zahl: Probleme im Verlauf.
        */}
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="announce" className="gap-1.5 px-3 sm:flex-none">
            <Megaphone className="h-4 w-4" />
            Durchsage
          </TabsTrigger>
          <TabsTrigger value="zones" className="gap-1.5 px-3 sm:flex-none">
            <Speaker className="h-4 w-4" />
            Zonen
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5 px-3 sm:flex-none">
            <CalendarClock className="h-4 w-4" />
            Zeitpläne
          </TabsTrigger>
          <TabsTrigger value="content" className="gap-1.5 px-3 sm:flex-none">
            <FolderOpen className="h-4 w-4" />
            Inhalte
          </TabsTrigger>
          <TabsTrigger value="soundweb" className="gap-1.5 px-3 sm:flex-none">
            <SlidersHorizontal className="h-4 w-4" />
            Soundweb
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="gap-1.5 px-3 sm:flex-none"
            aria-label={problemCount > 0 ? `Verlauf, ${problemCount} Probleme` : undefined}
          >
            <History className="h-4 w-4" />
            Verlauf
            {problemCount > 0 && (
              <Badge variant="danger" className="h-4 min-w-4 px-1 text-[10px] tabular-nums">
                {problemCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── DURCHSAGE ────────────────────────────────────────────────────── */}
        <TabsContent value="announce">
          <AnnouncePanel
            zones={zones}
            templates={templates}
            onDone={refresh}
            voices={ttsVoices}
            live={live}
          />
        </TabsContent>

        {/* ── ZONEN ────────────────────────────────────────────────────────── */}
        <TabsContent value="zones" className="space-y-4">
          <SectionHeader
            text="Jede Zone ist ein Abspieler mit eigenem Verstärker."
            actionLabel="Neue Zone"
            actionShort="Zone"
            onAction={() => setZoneDialog({ open: true, zone: null })}
          />

          {zones.length === 0 ? (
            <EmptyState
              icon={Speaker}
              title="Noch keine Zone"
              text="Lege eine Beschallungszone an und ordne ihr einen Abspieler zu."
            />
          ) : (
            // `grid-cols-1` (minmax(0, 1fr)): ohne feste Spalte macht ein langer
            // Titel beim Mithören (`truncate`) die Spalte und damit die Seite breiter.
            // Ab `lg` zwei Spalten: über die volle Breite lag der Regler 1000 px lang.
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              {zones.map((zone) => (
                <ZoneCard
                  key={zone.id}
                  zone={zone}
                  roomSchedule={operatingSchedules.find((s) => s.id === zone.operatingScheduleId)}
                  timeZone={timeZone}
                  live={liveZones.get(zone.id)}
                  highlight={highlightZone === zone.id}
                  busy={busyZone === zone.id}
                  command={commands.commands.get(zone.id)}
                  now={commands.now}
                  notice={
                    zoneNotice?.zoneId === zone.id
                      ? zoneNotice
                      : monitor.error?.zoneId === zone.id
                        ? { zoneId: zone.id, tone: "danger", message: monitor.error.message }
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
                  onPlay={() => startStop(zone.id, "PLAY")}
                  onStop={() => startStop(zone.id, "STOP")}
                  onVolume={(volume) => control(zone.id, { action: "VOLUME", volume })}
                  onSync={() =>
                    control(
                      zone.id,
                      { action: "SYNC_LIBRARY" },
                      "Abgleich gesendet · der Abspieler lädt fehlende Titel im Hintergrund"
                    )
                  }
                  onDismiss={() => commands.dismiss(zone.id)}
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

        {/* ── SOUNDWEB ─────────────────────────────────────────────────────── */}
        <TabsContent value="soundweb">
          <SoundwebPanel
            devices={soundwebDevices}
            hubOnline={hubOnline}
            active={tab === "soundweb"}
            onChanged={refresh}
          />
        </TabsContent>

        {/* ── INHALTE ──────────────────────────────────────────────────────── */}
        <TabsContent value="content">
        <Tabs value={contentTab} onValueChange={showContent} className="gap-4">
          {/* Einmal anlegen, dann überall auswählen. Vier Bereiche, gleiche
              Kapsel wie oben; auf dem Handy zwei Zeilen zu je zwei. */}
          <TabsList className="w-full sm:w-fit" aria-label="Inhalte">
            <TabsTrigger value="library" className="gap-1.5 px-3 max-sm:basis-[calc(50%-2px)] sm:flex-none">
              <Music className="h-4 w-4" />
              Mediathek
            </TabsTrigger>
            <TabsTrigger value="playlists" className="gap-1.5 px-3 max-sm:basis-[calc(50%-2px)] sm:flex-none">
              <ListMusic className="h-4 w-4" />
              Playlists
            </TabsTrigger>
            <TabsTrigger value="streams" className="gap-1.5 px-3 max-sm:basis-[calc(50%-2px)] sm:flex-none">
              <Radio className="h-4 w-4" />
              Webradio
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5 px-3 max-sm:basis-[calc(50%-2px)] sm:flex-none">
              <Megaphone className="h-4 w-4" />
              Vorlagen
            </TabsTrigger>
          </TabsList>

        {/* ── MEDIATHEK ────────────────────────────────────────────────────── */}
        <TabsContent value="library">
          <LibraryPanel tracks={tracks} onChanged={refresh} />
        </TabsContent>

        {/* ── PLAYLISTS ────────────────────────────────────────────────────── */}
        <TabsContent value="playlists" className="space-y-4">
          <SectionHeader
            text="Playlists laufen als Hintergrundmusik in den Zonen."
            actionLabel="Neue Playlist"
            actionShort="Playlist"
            onAction={() => setPlaylistDialog({ open: true, playlist: null })}
          />

          {playlists.length === 0 ? (
            <EmptyState
              icon={ListMusic}
              title="Noch keine Playlist"
              text="Stelle aus der Mediathek eine Titelliste für den laufenden Betrieb zusammen."
            />
          ) : (
            <Card flush="y" className="divide-y divide-border">
              {playlists.map((playlist) => (
                <div key={playlist.id} className="px-4 py-3 sm:px-[18px]">
                  {/* Handy: Tasten neben Titel und Badges, die Angaben darunter über die volle Breite */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          {playlist.name}
                        </h3>
                        <Badge variant="secondary" className="text-xs tabular-nums">
                          {playlist.trackIds.length} Titel
                        </Badge>
                        {playlist.shuffle && (
                          <Badge variant="outline" className="text-xs">
                            Zufall
                          </Badge>
                        )}
                    </div>
                    <div className="flex shrink-0 gap-1 sm:row-span-2">
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
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="text-xs tabular-nums text-muted-foreground mt-1">
                        {playlist.description ? `${playlist.description} · ` : ""}
                        Gesamtlänge {formatDuration(playlist.totalSec || null)}
                        {playlist.crossfadeSec > 0 && ` · ${playlist.crossfadeSec}s Überblendung`}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>

        {/* ── WEBRADIO ─────────────────────────────────────────────────────── */}
        <TabsContent value="streams" className="space-y-4">
          <SectionHeader
            text="Sender einmal anlegen und in den Zonen auswählen."
            actionLabel="Neuer Sender"
            actionShort="Sender"
            onAction={() => setStreamDialog({ open: true, stream: null })}
          />

          {streams.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="Noch kein Webradio"
              text="Lege Sender mit Namen und Stream-URL an. In der Zone wählst du sie dann aus der Liste."
            />
          ) : (
            <Card flush="y" className="divide-y divide-border">
              {streams.map((stream) => (
                <div key={stream.id} className="px-4 py-3 sm:px-[18px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-foreground">
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
                  </div>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>
        <TabsContent value="templates" className="space-y-4">
          <SectionHeader
            text="Gespeicherte Durchsagen stehen als Schnellwahl und in Zeitplänen zur Verfügung."
            actionLabel="Neue Durchsage"
            actionShort="Durchsage"
            onAction={() => setAnnouncementDialog({ open: true, announcement: null })}
          />

          {templates.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Noch keine gespeicherte Durchsage"
              text="Lege wiederkehrende Ansagen wie Betriebsschluss oder Kursbeginn einmal an."
            />
          ) : (
            <Card flush="y" className="divide-y divide-border">
              {templates.map((template) => (
                <div key={template.id} className="px-4 py-3 sm:px-[18px]">
                  {/* Handy: Tasten neben Titel und Badges, die Angaben darunter über die volle Breite */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
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
                    <div className="flex shrink-0 gap-1 sm:row-span-2">
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
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      {template.text && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.text}</p>
                      )}
                      <p className="text-xs tabular-nums text-muted-foreground mt-1">
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
                  </div>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>
        </Tabs>
        </TabsContent>

        {/* ── ZEITPLÄNE ────────────────────────────────────────────────────── */}
        <TabsContent value="schedules" className="space-y-4">
          <SectionHeader
            text="Zeitpläne werden jede Minute geprüft."
            actionLabel="Neuer Zeitplan"
            actionShort="Zeitplan"
            onAction={() => setScheduleDialog({ open: true, schedule: null })}
          />

          {schedules.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Noch kein Zeitplan"
              text="Musik zum Betriebsbeginn, Durchsagen vor Betriebsende, Kursansagen zur Uhrzeit."
            />
          ) : (
            <Card flush="y" className="divide-y divide-border">
              {schedules.map((schedule) => (
                <div key={schedule.id} className="px-4 py-3 sm:px-[18px]">
                  {/* Handy: Tasten neben Titel und Badges, die Angaben darunter über die volle Breite */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {/* Abgeschaltet: Text bleibt lesbar, den Zustand sagt das Badge (Abschnitt 17). */}
                        <h3 className="text-sm font-semibold text-foreground">{schedule.name}</h3>
                        {!schedule.isActive && <Badge variant="neutral">Abgeschaltet</Badge>}
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
                    <div className="flex shrink-0 items-center gap-1 sm:row-span-2">
                      {/* Ja/Nein mit sofortiger Wirkung: Schalter (Abschnitt 16). */}
                      <span className="flex h-11 w-12 items-center justify-center sm:h-8 sm:w-11">
                        <Switch
                          checked={scheduleOverride.get(schedule.id) ?? schedule.isActive}
                          onCheckedChange={(checked) => toggleSchedule(schedule, checked)}
                          aria-label={`Zeitplan ${schedule.name} aktiv`}
                          title={
                            (scheduleOverride.get(schedule.id) ?? schedule.isActive)
                              ? "Aktiv – zum Abschalten tippen"
                              : "Abgeschaltet – zum Einschalten tippen"
                          }
                        />
                      </span>
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
                    <div className="col-span-2 min-w-0 sm:col-span-1">
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
                      <p className="text-xs tabular-nums text-muted-foreground mt-0.5">
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
                      {scheduleError?.id === schedule.id && (
                        <Notice
                          tone="danger"
                          compact
                          role="alert"
                          title={scheduleError.message}
                          className="mt-2"
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <BirthdayAnnounceCard
            setting={birthdayAnnounce}
            zones={zones}
            voices={ttsVoices}
            tracks={tracks}
            appEnabled={riderAppEnabled}
          />
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

      <ConfirmDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title={`„${deleteConfirm?.name ?? ""}“ löschen?`}
        description={
          deleteConfirm?.kind === "zone"
            ? "Die Zone verschwindet aus Durchsagen und Zeitplänen. Der Abspieler bleibt als Gerät erhalten."
            : "Das lässt sich nicht rückgängig machen."
        }
        onConfirm={confirmDelete}
      />
    </div>
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
        "h-11 w-11 sm:h-8 sm:w-8",
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
  roomSchedule,
  timeZone,
  live,
  highlight,
  busy,
  command,
  now,
  notice,
  monitor,
  onPlay,
  onStop,
  onVolume,
  onSync,
  onPairing,
  onEdit,
  onDelete,
  onDismiss,
}: {
  zone: ZoneRow;
  /** Betriebszeit des Raums – für die Musik-Automatik „Betriebszeit des Raums“. */
  roomSchedule: OperatingScheduleOption | undefined;
  timeZone: string;
  live: ZoneStatus | undefined;
  highlight: boolean;
  /** Lautstärke, Abgleich oder Kopplung werden gerade gesendet. */
  busy: boolean;
  /** Offener oder gescheiterter Start/Stopp. */
  command: ZoneCommandState | undefined;
  now: number;
  /** Rückmeldung zu Lautstärke, Abgleich, Kopplung oder Mithören. */
  notice: ZoneNotice | null;
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
  onDismiss: () => void;
}) {
  const serverVolume = live?.volume ?? zone.volume;
  const isPlaying = live?.isPlaying ?? zone.isPlaying;
  const deviceOnline = live?.deviceOnline ?? zone.deviceOnline;
  const currentTitle = live?.currentTitle ?? zone.currentTitle;
  const pendingJobs = live?.pendingJobs ?? 0;
  const isActive = live?.isActive ?? zone.isActive;
  // Der Livewert ist auch dann maßgeblich, wenn er null ist: eine gerade
  // beendete Übernahme darf nicht als laufend stehen bleiben.
  const externalActive = live ? live.externalActive : zone.externalActive;
  const externalSender = live ? live.externalSender : zone.externalSender;
  const pairableFor = live?.pairableFor ?? zone.pairableFor;
  const musicOverrideUntil = live ? live.musicOverrideUntil : zone.musicOverrideUntil;

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
  const musicState = describeMusicState(
    { ...zone, musicOverrideUntil },
    roomSchedule,
    new Date(now),
    timeZone
  );

  const pending = command && command.phase !== "failed" ? command : null;
  const waitedSec = pending ? Math.max(0, Math.round((now - pending.since) / 1000)) : 0;
  // Was die Taste tut, folgt dem gemeldeten Zustand – solange ein Befehl offen
  // ist, dem gewünschten, damit sie nicht zwischendurch zurückspringt.
  const showStop = pending ? pending.action === "PLAY" : isPlaying;

  // Warum Start gerade nichts bewirken kann – statt die Taste stumm zu sperren.
  const blockedReason = !zone.deviceId
    ? "Kein Abspieler zugeordnet · in den Einstellungen der Zone wählen"
    : !isActive
      ? "Zone ist deaktiviert · in den Einstellungen einschalten"
      : zone.defaultSource === "SILENCE"
        ? "Keine Quelle eingestellt · Playlist oder Webradio in den Einstellungen wählen"
        : null;

  const sourceName =
    zone.defaultSource === "STREAM"
      ? (zone.streamName ?? "Webradio")
      : zone.defaultSource === "PLAYLIST"
        ? (zone.playlistName ?? "Playlist")
        : null;

  const state: { label: string; detail: string; tone: "music" | "neutral" | "danger" | "info" } =
    pending
      ? {
          label: pending.action === "PLAY" ? "Startet …" : "Stoppt …",
          detail:
            pending.phase === "sending"
              ? "Befehl wird gesendet"
              : `Wartet auf den Abspieler · ${waitedSec} s`,
          tone: "neutral",
        }
      : externalActive
        ? {
            label: `${EXTERNAL_LABELS[externalActive]} spielt`,
            detail: externalSender ?? "Ein Gerät sendet in die Zone",
            tone: "info",
          }
        : isPlaying
          ? {
              label: "Läuft",
              detail: currentTitle ?? sourceName ?? "Wiedergabe",
              tone: "music",
            }
          : zone.deviceId && !deviceOnline
            ? {
                label: "Offline",
                detail: lastSeen ? `zuletzt gemeldet ${lastSeen}` : "Abspieler hat sich nie gemeldet",
                tone: "danger",
              }
            : {
                label: "Aus",
                detail: sourceName ? `Start spielt ${sourceName}` : "Keine Quelle eingestellt",
                tone: "neutral",
              };

  return (
    <Card
      ref={cardRef}
      className={cn(
        // Umriss statt Ring: ein Ring ersetzt den Glasschatten der Karte.
        highlight && "outline-2 outline-primary"
      )}>
      <CardContent className="space-y-3">
        {/* Kopf: Name und nur das, was vom Normalbetrieb abweicht. */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pt-1.5 sm:pt-0.5">
            <h3 className="text-sm font-semibold text-foreground">{zone.name}</h3>
            {/* Inaktiv: Text bleibt lesbar, den Zustand sagt das Badge (docs/design-regeln.md, Abschnitt 17). */}
            {!isActive && <Badge variant="neutral">Deaktiviert</Badge>}
            {!zone.deviceId && (
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
            {!pending && pendingJobs > 0 && (
              <Badge variant="warning" className="gap-1 text-xs tabular-nums" title="Befehle, die der Abspieler noch nicht bestätigt hat">
                <Clock className="h-3 w-3" />
                {pendingJobs} wartet
              </Badge>
            )}
          </div>

          <div className="-mr-1 -mt-1 flex shrink-0 gap-0.5 sm:mt-0">
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
              className={cn(monitor.active && "text-primary bg-primary/10 hover:bg-primary/10")}
            />
            <IconAction
              icon={Pencil}
              label={`Zone ${zone.name} bearbeiten`}
              title="Bearbeiten"
              onClick={onEdit}
            />
            {/* Seltenes liegt einen Tipp tiefer (Abschnitt 1, Grundsatz 4). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Weitere Aktionen für ${zone.name}`}
                  title="Mehr"
                  className="h-11 w-11 sm:h-8 sm:w-8"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onSelect={onSync} disabled={!zone.deviceId}>
                  <RefreshCw />
                  Titel auf Abspieler laden
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 />
                  Zone löschen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/*
          Zustand und Taste in einer Kachel: erst sehen, dann tippen. Die Kachel
          leuchtet violett, solange Musik läuft (Zustandsvokabular, Abschnitt 3).
          Immer nur eine Taste – Stopp, solange die Zone spielt, sonst Start.
        */}
        <div
          className={cn(
            "glass-tile flex items-center gap-3 p-2.5 transition-colors",
            state.tone === "music" &&
              "border-violet-400/45 bg-violet-400/15",
            state.tone === "info" && "border-info/40 bg-info/[0.06]"
          )}
        >
          <IconChip
            icon={
              pending
                ? Loader2
                : externalActive === "AIRPLAY"
                  ? Airplay
                  : externalActive
                    ? Bluetooth
                    : state.tone === "danger"
                      ? WifiOff
                      : isPlaying
                        ? Volume2
                        : VolumeX
            }
            tone={state.tone}
            active={state.tone === "music" || state.tone === "info"}
            size="lg"
            className={cn(pending && "[&_svg]:animate-spin")}
          />
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-sm font-semibold text-foreground">{state.label}</p>
            <p className="line-clamp-2 text-xs break-words text-muted-foreground tabular-nums">{state.detail}</p>
          </div>
          {showStop ? (
            <Button
              variant="outline"
              onClick={onStop}
              disabled={!!pending}
              aria-label={`${zone.name} stoppen`}
              className="h-11 shrink-0 gap-1.5 px-4 sm:h-9"
            >
              {pending?.action === "STOP" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              Stopp
            </Button>
          ) : (
            <Button
              onClick={onPlay}
              disabled={!!pending || blockedReason !== null}
              aria-label={`${zone.name} starten`}
              title={blockedReason ?? undefined}
              className="h-11 shrink-0 gap-1.5 px-4 sm:h-9"
            >
              {pending?.action === "PLAY" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Start
            </Button>
          )}
        </div>

        {blockedReason && !showStop && (
          <p className="-mt-1 text-xs text-muted-foreground">{blockedReason}</p>
        )}

        {command?.phase === "failed" && (
          <Notice
            tone="danger"
            compact
            role="alert"
            title={command.message}
            action={
              <Button variant="ghost" size="sm" onClick={onDismiss} className="max-sm:h-11">
                Schließen
              </Button>
            }
          />
        )}

        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
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

        {musicState && (
          <p
            className={cn(
              "flex items-start gap-1.5 text-xs",
              musicState.warn ? "text-warning" : "text-muted-foreground"
            )}
          >
            <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {musicState.text}
              {musicWindow && ` · ${musicWindow}`}
            </span>
          </p>
        )}

        {externalActive && (
          <Notice tone="info" compact icon={externalActive === "AIRPLAY" ? Airplay : Bluetooth}>
            <span>
              Die eigene Quelle läuft weiter, sobald die Verbindung endet – Durchsagen kommen auch
              währenddessen durch.
            </span>
          </Notice>
        )}

        {zone.bluetoothEnabled && (
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <Button
              variant="outline"
              onClick={() => onPairing(pairable === 0)}
              disabled={busy}
              className="h-11 shrink-0 gap-1.5 text-xs sm:h-8"
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
          <div className="flex flex-col gap-1 rounded-tile border border-primary/30 bg-primary/10 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
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
                className="h-11 shrink-0 text-xs sm:h-8"
              >
                Beenden
              </Button>
            </div>
          </div>
        )}

        {notice && (
          <Notice
            tone={notice.tone}
            compact
            role={notice.tone === "danger" ? "alert" : "status"}
            title={notice.message}
          />
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
    if (filter === "announcements") {
      return jobs.filter((job) => job.kind === "ANNOUNCE" || job.kind === "LIVE");
    }
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Handy: volle Breite, 10 px Innenabstand – so bleiben die drei Filter
            samt Zahl bei 360 px in einer Zeile (mit 14 px bräche „Nur Probleme“ allein um). */}
        <Segmented
          value={filter}
          onValueChange={setFilter}
          aria-label="Verlauf filtern"
          className="max-sm:w-full"
          options={HISTORY_FILTERS.map((option) => ({
            value: option.value,
            label: option.label,
            count: option.value === "problems" && problems.length > 0 ? problems.length : undefined,
          }))}
        />
        <p className="text-xs text-muted-foreground">Aktualisiert sich automatisch</p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nichts gefunden"
          text="Für diesen Filter gibt es keine Einträge – bei „Nur Probleme“ ist das die gute Nachricht."
        />
      ) : (
        <Card flush="y">
          <CardContent className="divide-y divide-border px-0 sm:px-0">
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
    <div className="flex items-start gap-3 px-4 py-3 sm:px-[18px]">
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
        <p className="text-xs tabular-nums text-muted-foreground">
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
  icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <Card className="py-0 sm:py-0">
      <EmptyStateBlock icon={icon} title={title} description={text} />
    </Card>
  );
}

