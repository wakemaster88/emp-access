/**
 * Audio-Steuerung für Integrationen (emp-control) und das Geräte-Action-API.
 *
 * Abspieler hängen als `AUDIO_PLAYER` in der Geräteliste. Play/Stopp gehen über
 * dieselben Aktionsnamen wie Türen (`open`/`stop`); Lautstärke, Playlist,
 * einzelner Titel und Stream-URL über `POST /api/devices/[id]/audio`.
 *
 * Bewusst ohne Dashboard-only-Befehle wie Bibliothek-Sync – die bleiben am
 * Zonen-Endpunkt, den nur eine Admin-Session erreicht.
 */
import type { Prisma } from "@prisma/client";
import type { TenantDb } from "@/lib/prisma";
import { clampVolume, playlistPayload, queueZoneCommand } from "@/lib/audio";
import { isAudioDevice, withDeviceControlInfo, type ControllableDevice } from "@/lib/device-controls";

type Db = TenantDb;

const MAX_STREAM_URL = 2000;

export const AUDIO_ZONE_SELECT = {
  id: true,
  name: true,
  isActive: true,
  isPlaying: true,
  volume: true,
  currentTitle: true,
  sourceKind: true,
  defaultSource: true,
  streamUrl: true,
  playlistId: true,
  playlist: { select: { id: true, name: true } },
} as const;

export type AudioZoneSnapshotSource = {
  id: number;
  name: string;
  isActive: boolean;
  isPlaying: boolean;
  volume: number;
  currentTitle: string | null;
  sourceKind: string;
  defaultSource: string;
  streamUrl: string | null;
  playlistId: number | null;
  playlist: { id: number; name: string } | null;
};

export type AudioSnapshot = {
  zoneId: number;
  zoneName: string;
  isPlaying: boolean;
  volume: number;
  currentTitle: string | null;
  sourceKind: string;
  defaultSource: string;
  playlistId: number | null;
  playlistName: string | null;
  streamUrl: string | null;
};

export type AudioLibrary = {
  playlists: { id: number; name: string; trackCount: number }[];
  tracks: { id: number; title: string; artist: string | null; durationSec: number | null }[];
  streams: { id: number; name: string; url: string }[];
  /** Alias mit String-IDs für emp-control. */
  webradios: { id: string; name: string; url: string }[];
};

export type AudioControlInput = {
  action: "PLAY" | "STOP" | "VOLUME";
  volume?: unknown;
  playlistId?: unknown;
  trackId?: unknown;
  streamUrl?: unknown;
  /**
   * Ob eine mitgeschickte Stream-URL als neue Zonen-Vorgabe gespeichert wird.
   * Katalog-Sender aus emp-control speichern wir, damit die Zone auf dem
   * gewählten Webradio bleibt. Freie URLs bleiben einmalig, wenn false.
   */
  persistStreamUrl?: boolean;
};

export type AudioControlResult =
  | { ok: true; volume?: number }
  | { ok: false; error: string; status: number };

type ZoneForControl = {
  id: number;
  volume: number;
  defaultSource: "SILENCE" | "PLAYLIST" | "STREAM";
  streamId: number | null;
  streamUrl: string | null;
  playlistId: number | null;
};

export function toAudioSnapshot(zone: AudioZoneSnapshotSource): AudioSnapshot | null {
  if (!zone.isActive) return null;
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    isPlaying: zone.isPlaying,
    volume: zone.volume,
    currentTitle: zone.currentTitle,
    sourceKind: zone.sourceKind,
    defaultSource: zone.defaultSource,
    playlistId: zone.playlistId,
    playlistName: zone.playlist?.name ?? null,
    streamUrl: zone.streamUrl,
  };
}

/** Gerätedatensatz für die API, inkl. Audio-Ist-Zustand bei Abspielern. */
export function withAudioDeviceInfo<T extends ControllableDevice & {
  audioZone?: AudioZoneSnapshotSource | null;
}>(device: T) {
  const { audioZone, ...rest } = device;
  const payload = withDeviceControlInfo(rest);
  if (!isAudioDevice(rest)) return payload;
  return { ...payload, audio: audioZone ? toAudioSnapshot(audioZone) : null };
}

export function parseStreamUrl(value: unknown): { url: string } | { error: string } {
  if (typeof value !== "string") return { error: "Keine Stream-URL" };
  const url = value.trim();
  if (!url) return { error: "Keine Stream-URL" };
  if (url.length > MAX_STREAM_URL) return { error: "Stream-URL zu lang" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Ungültige Stream-URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Stream-URL muss http oder https sein" };
  }
  return { url };
}

async function resolveZoneStreamUrl(
  db: Db,
  zone: ZoneForControl
): Promise<{ url: string } | { error: string }> {
  if (zone.streamId) {
    const stream = await db.audioStream.findFirst({
      where: { id: zone.streamId },
      select: { url: true },
    });
    if (stream?.url) return { url: stream.url };
  }
  if (zone.streamUrl) return { url: zone.streamUrl };
  return { error: "Kein Webradio ausgewählt" };
}

/**
 * Gerät-Aktion aus `POST /api/devices/[id]/action` auf ein Audio-Kommando.
 * `open` startet die Zonen-Vorgabe; Quelle und Lautstärke gehören an den
 * Audio-Endpunkt.
 */
export function audioInputFromDeviceAction(action: string): AudioControlInput | null {
  if (action === "open") return { action: "PLAY", persistStreamUrl: false };
  if (action === "stop" || action === "reset" || action === "deactivate") {
    return { action: "STOP" };
  }
  return null;
}

export function audioCommandLabel(input: AudioControlInput): string {
  if (input.action === "STOP") return "Stopp";
  if (input.action === "VOLUME") {
    const volume = clampVolume(input.volume, NaN);
    return Number.isFinite(volume) ? `Lautstärke ${volume} %` : "Lautstärke";
  }
  if (input.trackId != null) return "Titel starten";
  if (input.playlistId != null) return "Playlist starten";
  if (input.streamUrl != null) return "Stream starten";
  return "Start";
}

export async function fetchAudioLibrary(db: Db, accountId: number): Promise<AudioLibrary> {
  const [playlists, tracks, streams] = await Promise.all([
    db.audioPlaylist.findMany({
      where: { accountId },
      select: { id: true, name: true, _count: { select: { items: true } } },
      orderBy: { name: "asc" },
    }),
    db.audioTrack.findMany({
      where: { accountId, kind: { in: ["MUSIC", "JINGLE"] } },
      select: { id: true, title: true, artist: true, durationSec: true },
      orderBy: { title: "asc" },
    }),
    db.audioStream.findMany({
      where: { accountId },
      select: { id: true, name: true, url: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    playlists: playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist._count.items,
    })),
    tracks,
    streams,
    webradios: streams.map((stream) => ({
      id: String(stream.id),
      name: stream.name,
      url: stream.url,
    })),
  };
}

export async function controlAudioZone(
  db: Db,
  accountId: number,
  zone: ZoneForControl,
  input: AudioControlInput,
): Promise<AudioControlResult> {
  if (input.action === "STOP") {
    await queueZoneCommand(db, accountId, [zone], "STOP", null, "MANUAL");
    await db.audioZone.update({
      where: { id: zone.id },
      data: { sourceKind: "SILENCE" },
    });
    return { ok: true };
  }

  if (input.action === "VOLUME") {
    const volume = clampVolume(input.volume, zone.volume);
    await queueZoneCommand(db, accountId, [zone], "VOLUME", { volume }, "MANUAL");
    await db.audioZone.update({ where: { id: zone.id }, data: { volume } });
    return { ok: true, volume };
  }

  const trackId = input.trackId != null ? Number(input.trackId) : null;
  if (trackId != null && Number.isInteger(trackId) && trackId > 0) {
    return playTrack(db, accountId, zone, trackId);
  }

  const playlistGiven = input.playlistId != null && input.playlistId !== "";
  const streamGiven = input.streamUrl != null && input.streamUrl !== "";

  const source = streamGiven
    ? "STREAM"
    : playlistGiven
      ? "PLAYLIST"
      : zone.defaultSource;

  if (source === "SILENCE") {
    return { ok: false, error: "Für diese Zone ist keine Quelle eingestellt", status: 400 };
  }

  if (source === "STREAM") {
    const parsed = streamGiven
      ? parseStreamUrl(input.streamUrl)
      : await resolveZoneStreamUrl(db, zone);
    if ("error" in parsed) return { ok: false, error: parsed.error, status: 400 };

    await queueZoneCommand(
      db,
      accountId,
      [zone],
      "PLAY",
      { kind: "STREAM", url: parsed.url, volume: zone.volume },
      "MANUAL",
    );

    const persist = input.persistStreamUrl !== false || parsed.url === zone.streamUrl;
    const matched = await db.audioStream.findFirst({
      where: { accountId, url: parsed.url },
      select: { id: true, name: true },
    });
    await db.audioZone.update({
      where: { id: zone.id },
      data: {
        sourceKind: "STREAM",
        currentTitle: matched?.name ?? "Webradio",
        ...(persist
          ? {
              streamUrl: parsed.url,
              ...(matched ? { streamId: matched.id } : {}),
            }
          : {}),
      },
    });
    return { ok: true };
  }

  const playlistId = playlistGiven ? Number(input.playlistId) : zone.playlistId;
  if (!playlistId || !Number.isInteger(playlistId)) {
    return { ok: false, error: "Keine Playlist ausgewählt", status: 400 };
  }

  const owned = await db.audioPlaylist.findFirst({
    where: { id: playlistId, accountId },
    select: { id: true },
  });
  if (!owned) return { ok: false, error: "Playlist nicht gefunden", status: 404 };

  const payload = await playlistPayload(db, playlistId);
  if (!payload) return { ok: false, error: "Playlist nicht gefunden", status: 404 };

  await queueZoneCommand(
    db,
    accountId,
    [zone],
    "PLAY",
    { kind: "PLAYLIST", volume: zone.volume, ...(payload as object) },
    "MANUAL",
  );
  await db.audioZone.update({
    where: { id: zone.id },
    data: { sourceKind: "PLAYLIST", playlistId },
  });
  return { ok: true };
}

async function playTrack(
  db: Db,
  accountId: number,
  zone: ZoneForControl,
  trackId: number,
): Promise<AudioControlResult> {
  const track = await db.audioTrack.findFirst({
    where: { id: trackId, accountId, kind: { in: ["MUSIC", "JINGLE"] } },
    select: { id: true, title: true, url: true },
  });
  if (!track) return { ok: false, error: "Titel nicht gefunden", status: 404 };

  const payload: Prisma.InputJsonValue = {
    kind: "PLAYLIST",
    volume: zone.volume,
    name: track.title,
    shuffle: false,
    tracks: [{ id: track.id, title: track.title, url: track.url }],
  };
  await queueZoneCommand(db, accountId, [zone], "PLAY", payload, "MANUAL");
  await db.audioZone.update({
    where: { id: zone.id },
    data: { sourceKind: "PLAYLIST" },
  });
  return { ok: true };
}

export async function controlAudioDevice(
  db: Db,
  accountId: number,
  device: { id: number; type: string; category: string | null },
  input: AudioControlInput,
): Promise<AudioControlResult> {
  if (!isAudioDevice(device)) {
    return { ok: false, error: "Gerät ist keine Audio-Zone", status: 400 };
  }

  const zone = await db.audioZone.findFirst({
    where: { deviceId: device.id, accountId, isActive: true },
    select: {
      id: true,
      volume: true,
      defaultSource: true,
      streamId: true,
      streamUrl: true,
      playlistId: true,
    },
  });
  if (!zone) {
    return { ok: false, error: "Keine Beschallungszone zugeordnet", status: 404 };
  }

  return controlAudioZone(db, accountId, zone, input);
}

export function parseAudioControlBody(body: Record<string, unknown>): AudioControlInput | { error: string } {
  const action = body.action;
  if (action === "STOP" || action === "stop") return { action: "STOP" };
  if (action === "VOLUME" || action === "volume") {
    return { action: "VOLUME", volume: body.volume };
  }
  if (action === "PLAY" || action === "play" || action === "open") {
    return {
      action: "PLAY",
      playlistId: body.playlistId,
      trackId: body.trackId,
      streamUrl: body.streamUrl,
      persistStreamUrl: body.persistStreamUrl === true,
    };
  }
  return { error: "Unbekannte Aktion" };
}
