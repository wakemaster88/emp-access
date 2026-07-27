import type {
  AudioAnnouncementSource,
  AudioJobKind,
  AudioJobStatus,
  AudioScheduleAction,
  AudioSourceKind,
  AudioTrackKind,
} from "@prisma/client";

export interface ZoneRow {
  id: number;
  name: string;
  deviceId: number | null;
  deviceName: string | null;
  /** Serverseitig aus dem letzten Heartbeat abgeleitet. */
  deviceOnline: boolean;
  isActive: boolean;
  syncGroup: string | null;
  volume: number;
  announcementVolume: number;
  duckVolume: number;
  sourceKind: AudioSourceKind;
  playlistId: number | null;
  playlistName: string | null;
  streamUrl: string | null;
  quietFrom: string | null;
  quietTo: string | null;
  isPlaying: boolean;
  currentTitle: string | null;
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
  timeOfDay: string;
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
}

export type { AudioSourceKind, AudioScheduleAction, AudioTrackKind, AudioAnnouncementSource };
