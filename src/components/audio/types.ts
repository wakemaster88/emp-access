import type {
  AudioAnnouncementSource,
  AudioExternalKind,
  AudioJobKind,
  AudioJobStatus,
  AudioScheduleAction,
  AudioScheduleTrigger,
  AudioSourceKind,
  AudioTrackKind,
  RuleOperatingCondition,
} from "@prisma/client";
import type { ExceptionSpec, SeasonSpec } from "@/lib/operating-hours";

export interface ZoneRow {
  id: number;
  name: string;
  deviceId: number | null;
  deviceName: string | null;
  /** Serverseitig aus dem letzten Heartbeat abgeleitet. */
  deviceOnline: boolean;
  /** Raum, den die Zone beschallt. Über ihn erbt sie die Betriebszeit. */
  roomId: number | null;
  roomName: string | null;
  /** Betriebszeit des Raums, aufgelöst – null, wenn Raum oder Profil fehlt. */
  operatingScheduleId: number | null;
  isActive: boolean;
  syncGroup: string | null;
  volume: number;
  announcementVolume: number;
  duckVolume: number;
  /** Was gerade läuft. */
  sourceKind: AudioSourceKind;
  /** Was „Start“ abspielt – Einstellung der Zone, überlebt einen Stopp. */
  defaultSource: AudioSourceKind;
  playlistId: number | null;
  playlistName: string | null;
  streamId: number | null;
  streamName: string | null;
  streamUrl: string | null;
  /** Musik nur zur Betriebszeit des Raums, je Ende mit Versatz in Minuten. */
  musicOperating: boolean;
  musicOpenOffset: number;
  musicCloseOffset: number;
  /** Empfänger, über die ein Sender die Zone übernehmen darf. */
  airplayEnabled: boolean;
  bluetoothEnabled: boolean;
  /** Name als AirPlay-/Bluetooth-Ziel. null = Zonenname. */
  externalName: string | null;
  isPlaying: boolean;
  currentTitle: string | null;
  /** Sender, der die Zone gerade übernommen hat. null = niemand. */
  externalActive: AudioExternalKind | null;
  externalSender: string | null;
  /** Restlaufzeit des Bluetooth-Kopplungsfensters in Sekunden, 0 = geschlossen. */
  pairableFor: number;
  lastStateAt: string | null;
}

export interface TrackRow {
  id: number;
  title: string;
  artist: string | null;
  kind: AudioTrackKind;
  url: string;
  durationSec: number | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface PlaylistRow {
  id: number;
  name: string;
  description: string | null;
  shuffle: boolean;
  crossfadeSec: number;
  trackIds: number[];
  totalSec: number;
}

export interface StreamRow {
  id: number;
  name: string;
  url: string;
}

export interface AnnouncementRow {
  id: number;
  name: string;
  source: AudioAnnouncementSource;
  text: string | null;
  voice: string | null;
  trackId: number | null;
  chime: boolean;
  repeatCount: number;
  priority: number;
  zoneIds: number[];
  isTemplate: boolean;
  lastPlayedAt: string | null;
}

export interface ScheduleRow {
  id: number;
  name: string;
  isActive: boolean;
  action: AudioScheduleAction;
  daysOfWeek: number;
  /** Woran sich der Zeitpunkt bemisst: Uhrzeit oder Betriebsbeginn/-ende. */
  trigger: AudioScheduleTrigger;
  /** Nur bei trigger = TIME gesetzt. */
  timeOfDay: string | null;
  /** Verschiebung in Minuten gegenüber Betriebsbeginn/-ende. */
  offsetMinutes: number;
  /** Ausdrücklich gewählte Betriebszeit; null = die des Raums der Zielzone. */
  operatingScheduleId: number | null;
  operatingScheduleName: string | null;
  /** Bedingung an die Betriebszeit der Zielzone. */
  operating: RuleOperatingCondition;
  zoneIds: number[];
  announcementId: number | null;
  announcementName: string | null;
  playlistId: number | null;
  playlistName: string | null;
  volume: number | null;
  lastRunAt: string | null;
}

export interface JobRow {
  id: number;
  zoneName: string;
  kind: AudioJobKind;
  status: AudioJobStatus;
  triggerKind: string;
  announcementName: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** Ist-Zustand einer Zone aus `/api/audio/status` – überschreibt die Serverdaten. */
export interface ZoneStatus {
  id: number;
  isActive: boolean;
  isPlaying: boolean;
  currentTitle: string | null;
  volume: number;
  reportedVolume: number | null;
  externalActive: AudioExternalKind | null;
  externalSender: string | null;
  pairableFor: number;
  deviceOnline: boolean;
  lastStateAt: string | null;
  /** Befehle, die der Abspieler noch nicht bestätigt hat. */
  pendingJobs: number;
}

export interface AudioDeviceOption {
  id: number;
  name: string;
  /** true, wenn das Gerät bereits einer anderen Zone zugeordnet ist. */
  taken: boolean;
  /**
   * Empfangsdienste, die der Abspieler im Heartbeat gemeldet hat. Fehlt einer,
   * bleibt der zugehörige Schalter gesperrt – der Pi würde die Einstellung
   * sonst still übergehen.
   */
  backends: string[];
}

/** Raum zur Auswahl im Zonen-Dialog. */
export interface RoomOption {
  id: number;
  name: string;
  /** Betriebszeit des Raums – null, wenn er keine hat. */
  operatingScheduleId: number | null;
  operatingScheduleName: string | null;
}

/**
 * Betriebszeit samt Wochenplan, damit die Zeitplan-Karte "heute 19:45" ohne
 * Rückfrage beim Server anzeigen kann.
 */
export interface OperatingScheduleOption {
  id: number;
  name: string;
  seasons: SeasonSpec[];
  exceptions: ExceptionSpec[];
}

export type {
  AudioSourceKind,
  AudioScheduleAction,
  AudioScheduleTrigger,
  AudioTrackKind,
  AudioAnnouncementSource,
  AudioExternalKind,
  RuleOperatingCondition,
};
