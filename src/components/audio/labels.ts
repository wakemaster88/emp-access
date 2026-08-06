/**
 * Beschriftungen für die Audio-Oberfläche.
 *
 * Die Enum-Werte aus der Datenbank sind englisch und technisch – hier liegt die
 * einzige Stelle, an der sie in Klartext übersetzt werden.
 */
import type {
  AudioExternalKind,
  AudioJobKind,
  AudioJobStatus,
  AudioTrackKind,
} from "@prisma/client";
import { AUDIO_PLAYER_OFFLINE_AFTER_MS } from "@/lib/audio-constants";

export const JOB_KIND_LABELS: Record<AudioJobKind, string> = {
  ANNOUNCE: "Durchsage",
  PLAY: "Wiedergabe gestartet",
  STOP: "Wiedergabe gestoppt",
  VOLUME: "Lautstärke geändert",
  SYNC_LIBRARY: "Dateien abgeglichen",
};

export const JOB_STATUS_LABELS: Record<AudioJobStatus, string> = {
  PENDING: "Wartet auf Abspieler",
  SENT: "Zugestellt",
  PLAYING: "Läuft",
  DONE: "Erledigt",
  FAILED: "Fehlgeschlagen",
};

export const TRIGGER_LABELS: Record<string, string> = {
  MANUAL: "Manuell",
  SCHEDULE: "Zeitplan",
  EMERGENCY: "Notfall",
};

export const TRACK_KIND_LABELS: Record<AudioTrackKind, string> = {
  MUSIC: "Musik",
  JINGLE: "Jingle",
  CHIME: "Gong",
  ANNOUNCEMENT: "Ansage",
};

export const EXTERNAL_LABELS: Record<AudioExternalKind, string> = {
  AIRPLAY: "AirPlay",
  BLUETOOTH: "Bluetooth",
};

export function triggerLabel(value: string): string {
  return TRIGGER_LABELS[value] ?? value;
}

/** Restlaufzeit des Kopplungsfensters als m:ss. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Länge als m:ss, ab einer Stunde als h:mm:ss. */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Ein Befehl, den kein Abspieler abholt, bleibt für immer auf „wartet“ stehen –
 * etwa weil die Zone kein Gerät hat oder der Pi aus ist. Ab derselben Grenze,
 * ab der ein Abspieler als offline gilt, ist das kein Warten mehr, sondern ein
 * Hänger: der Pi fragt alle fünf Sekunden nach offenen Jobs.
 */
export function isJobStuck(job: { status: AudioJobStatus; createdAt: string }): boolean {
  if (job.status !== "PENDING" && job.status !== "SENT") return false;
  const age = Date.now() - new Date(job.createdAt).getTime();
  return Number.isFinite(age) && age > AUDIO_PLAYER_OFFLINE_AFTER_MS;
}

/** Kurzform wie „vor 3 Min." für Zustandsmeldungen der Abspieler. */
export function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return `vor ${Math.floor(hours / 24)} Tg.`;
}
