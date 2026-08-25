/**
 * Gemeinsame Logik des Audio-Moduls: Validierung, Zonenauflösung, Job-Queue
 * und TTS-Rendering.
 *
 * Kommandos an die Zonen laufen immer über `AudioJob`. Der Zonen-Pi holt offene
 * Jobs ab, spielt sie ab und meldet den Status zurück – so ist der Verlauf
 * lückenlos und ein kurzzeitig offline gewesener Pi arbeitet nach.
 */
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma, type TenantDb } from "@/lib/prisma";
import {
  DEFAULT_TTS_VOICE,
  MAX_ANNOUNCEMENT_CHARS,
  TTS_FALLBACK_VOICES,
  TTS_LANGUAGE,
  audioBackends,
  hasAudioBackend,
  normalizeTtsVoice,
  type TtsVoice,
} from "@/lib/audio-constants";

type Db = TenantDb;

export * from "@/lib/audio-constants";

/**
 * Zielzonen einer Durchsage auflösen. Ein leeres `zoneIds`-Array bedeutet
 * bewusst "alle aktiven Zonen" – so erreichen Notfalldurchsagen auch Zonen,
 * die erst nach dem Anlegen der Vorlage dazugekommen sind.
 */
export async function resolveTargetZones(
  db: Db,
  accountId: number,
  zoneIds: number[]
): Promise<{ id: number; name: string; deviceId: number | null }[]> {
  return db.audioZone.findMany({
    where: {
      accountId,
      isActive: true,
      ...(zoneIds.length > 0 ? { id: { in: zoneIds } } : {}),
    },
    select: { id: true, name: true, deviceId: true },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Empfangs-Backends, die der Abspieler einer Zone gemeldet hat. Ein Pi, auf dem
 * shairport-sync oder bluealsa fehlt, taucht hier leer auf – das Dashboard darf
 * den zugehoerigen Schalter dann nicht anbieten.
 */
export async function playerAudioBackends(
  db: Db,
  deviceId: number | null | undefined
): Promise<string[]> {
  if (!deviceId) return [];
  const device = await db.device.findUnique({
    where: { id: deviceId },
    select: { systemInfo: true },
  });
  return audioBackends(device?.systemInfo);
}

/**
 * Prueft, ob der Abspieler die gewuenschten Empfaenger ueberhaupt bedienen
 * kann. Gibt eine Fehlermeldung zurueck oder null, wenn es passt. Nur
 * neu einzuschaltende Empfaenger uebergeben – ein unveraenderter Schalter darf
 * ein Speichern nicht blockieren, etwa waehrend der Pi offline ist.
 */
export async function checkExternalReceivers(
  db: Db,
  deviceId: number | null | undefined,
  wanted: { airplay?: boolean; bluetooth?: boolean }
): Promise<string | null> {
  if (!wanted.airplay && !wanted.bluetooth) return null;
  if (!deviceId) {
    return "AirPlay und Bluetooth brauchen einen zugeordneten Abspieler";
  }

  const backends = await playerAudioBackends(db, deviceId);
  const missing = "ist auf diesem Abspieler nicht eingerichtet – install-audio.sh erneut ausführen";
  if (wanted.airplay && !hasAudioBackend(backends, "AIRPLAY")) {
    return `AirPlay-Empfang ${missing}`;
  }
  if (wanted.bluetooth && !hasAudioBackend(backends, "BLUETOOTH")) {
    return `Bluetooth-Empfang ${missing}`;
  }
  return null;
}

export type OwnedAudioStream = { id: number; name: string; url: string };

/**
 * Webradio-Sender des Mandanten. `null`/leer löst die Zuordnung.
 */
export async function resolveOwnedStream(
  db: Db,
  accountId: number,
  streamId: unknown
): Promise<OwnedAudioStream | { error: string } | null> {
  if (streamId === null || streamId === "") return null;
  const id = Number(streamId);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: "Ungültige Stream-ID" };
  }
  const stream = await db.audioStream.findFirst({
    where: { id, accountId },
    select: { id: true, name: true, url: true },
  });
  if (!stream) return { error: "Webradio nicht gefunden" };
  return stream;
}

export type AnnouncementForQueue = {
  id: number;
  source: string;
  text: string | null;
  voice: string | null;
  chime: boolean;
  repeatCount: number;
  priority: number;
  track: { id: number; url: string; durationSec: number | null } | null;
};

/**
 * Legt für jede Zielzone einen ANNOUNCE-Job an. Die Audio-URL wird direkt in
 * den Payload geschrieben, damit der Pi den Job ohne Rückfrage abspielen kann.
 */
export async function queueAnnouncement(
  db: Db,
  accountId: number,
  announcement: AnnouncementForQueue,
  zones: { id: number }[],
  triggerKind: string
): Promise<number> {
  if (zones.length === 0) return 0;
  if (!announcement.track) {
    throw new Error("Durchsage hat keine Audiodatei");
  }

  const payload: Prisma.InputJsonValue = {
    url: announcement.track.url,
    chime: announcement.chime,
    repeat: announcement.repeatCount,
    priority: announcement.priority,
    durationSec: announcement.track.durationSec,
  };

  const result = await db.audioJob.createMany({
    data: zones.map((zone) => ({
      accountId,
      zoneId: zone.id,
      kind: "ANNOUNCE" as const,
      announcementId: announcement.id,
      triggerKind,
      payload,
    })),
  });

  await db.audioAnnouncement.update({
    where: { id: announcement.id },
    data: { lastPlayedAt: new Date() },
  });

  return result.count;
}

/** Steuerkommando (Play/Stop/Lautstärke) an mehrere Zonen. */
export async function queueZoneCommand(
  db: Db,
  accountId: number,
  zones: { id: number }[],
  kind: "PLAY" | "STOP" | "VOLUME" | "SYNC_LIBRARY",
  payload: Prisma.InputJsonValue | null,
  triggerKind: string
): Promise<number> {
  if (zones.length === 0) return 0;
  const result = await db.audioJob.createMany({
    data: zones.map((zone) => ({
      accountId,
      zoneId: zone.id,
      kind,
      triggerKind,
      payload: payload ?? undefined,
    })),
  });
  return result.count;
}

/**
 * Tracks einer Playlist in Abspielreihenfolge – wird als Payload an den Pi
 * geschickt, damit er die Dateien vorab in seinen Cache laden kann.
 */
export async function playlistPayload(
  db: Db,
  playlistId: number
): Promise<Prisma.InputJsonValue | null> {
  const playlist = await db.audioPlaylist.findUnique({
    where: { id: playlistId },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { track: { select: { id: true, title: true, url: true } } },
      },
    },
  });
  if (!playlist) return null;

  return {
    playlistId: playlist.id,
    name: playlist.name,
    shuffle: playlist.shuffle,
    crossfadeSec: playlist.crossfadeSec,
    tracks: playlist.items.map((item) => ({
      id: item.track.id,
      title: item.track.title,
      url: item.track.url,
    })),
  };
}

export function ttsCacheKey(text: string, voice: string): string {
  return createHash("sha256").update(`${voice}\n${text}`).digest("hex");
}

export class TtsNotConfiguredError extends Error {
  constructor() {
    super("Sprachausgabe ist nicht konfiguriert (XAI_API_KEY fehlt)");
    this.name = "TtsNotConfiguredError";
  }
}

const TTS_ENDPOINT = "https://api.x.ai/v1/tts";
const TTS_VOICES_ENDPOINT = `${TTS_ENDPOINT}/voices`;

/**
 * Fragt die verfügbaren Stimmen bei xAI ab. Eine feste Liste im Code würde mit
 * jeder Änderung des Anbieters schief gehen – und eine Stimme, die es nicht
 * gibt, lehnt die API beim Rendern ab. Kommt die Abfrage nicht durch, bleibt es
 * bei den belegten Stimmen.
 */
export async function listTtsVoices(): Promise<TtsVoice[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return TTS_FALLBACK_VOICES;

  try {
    const response = await fetch(TTS_VOICES_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Der Bestand ändert sich selten, die Seite soll nicht darauf warten.
      next: { revalidate: 86400 },
    });
    if (!response.ok) return TTS_FALLBACK_VOICES;

    const data = (await response.json()) as {
      voices?: { voice_id?: unknown; name?: unknown; gender?: unknown }[];
    };
    const voices = (data.voices ?? [])
      .map((entry) => {
        const value = typeof entry.voice_id === "string" ? entry.voice_id : "";
        const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : value;
        // 26 Namen wie "Altair" oder "Zagan" sagen nichts darüber, wie die
        // Ansage klingt. Das Geschlecht ist der einzige Hinweis, den die API
        // mitliefert, und für die Auswahl der brauchbarste.
        const hints = [
          entry.gender === "female" ? "weiblich" : entry.gender === "male" ? "männlich" : null,
          value === DEFAULT_TTS_VOICE ? "Standard" : null,
        ].filter(Boolean);
        return { value, label: hints.length > 0 ? `${name} (${hints.join(", ")})` : name };
      })
      .filter((voice) => voice.value);

    return voices.length > 0 ? voices : TTS_FALLBACK_VOICES;
  } catch {
    return TTS_FALLBACK_VOICES;
  }
}

/**
 * Holt die Audiodaten aus der Antwort. xAI liefert die MP3 normalerweise als
 * Rohdaten, kann sie aber auch in einen JSON-Umschlag mit base64 packen – beides
 * kommt vor, deshalb entscheidet der Content-Type.
 */
async function readTtsAudio(response: Response): Promise<Buffer> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return Buffer.from(await response.arrayBuffer());
  }

  const data = (await response.json()) as { audio?: unknown };
  if (typeof data.audio !== "string" || !data.audio) {
    throw new Error("TTS-Antwort enthielt keine Audiodaten");
  }
  return Buffer.from(data.audio, "base64");
}

/**
 * Rendert einen Ansagetext zu MP3 und legt ihn als Track ab. Gleicher Text mit
 * gleicher Stimme liefert den bereits vorhandenen Track zurück, sodass für
 * wiederkehrende Durchsagen keine erneuten TTS-Kosten entstehen.
 */
export async function renderTtsTrack(
  db: Db,
  accountId: number,
  text: string,
  voice: string | null
): Promise<{ id: number; url: string; durationSec: number | null }> {
  const cleanText = text.trim().slice(0, MAX_ANNOUNCEMENT_CHARS);
  const usedVoice = normalizeTtsVoice(voice);
  const hash = ttsCacheKey(cleanText, usedVoice);

  const cached = await db.audioTrack.findFirst({
    where: { accountId, ttsHash: hash },
    select: { id: true, url: true, durationSec: true },
  });
  if (cached) return cached;

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new TtsNotConfiguredError();

  const response = await fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: cleanText,
      voice_id: usedVoice,
      language: TTS_LANGUAGE,
      output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`TTS fehlgeschlagen (${response.status}): ${detail.slice(0, 200)}`);
  }

  const audio = await readTtsAudio(response);
  const { put } = await import("@vercel/blob");
  const blob = await put(`audio/tts/${hash}.mp3`, audio, {
    access: "public",
    contentType: "audio/mpeg",
    addRandomSuffix: false,
  });

  const track = await db.audioTrack.create({
    data: {
      accountId,
      title: cleanText.slice(0, 80),
      kind: "ANNOUNCEMENT",
      url: blob.url,
      blobPathname: blob.pathname,
      contentType: "audio/mpeg",
      sizeBytes: audio.byteLength,
      ttsHash: hash,
    },
    select: { id: true, url: true, durationSec: true },
  });

  return track;
}

/**
 * Sorgt dafür, dass eine Durchsage eine abspielbare Datei hat: TTS-Ansagen
 * werden bei Bedarf gerendert, Datei-Ansagen müssen bereits einen Track haben.
 */
export async function ensureAnnouncementTrack(
  db: Db,
  accountId: number,
  announcement: {
    id: number;
    source: string;
    text: string | null;
    voice: string | null;
    trackId: number | null;
    track: { id: number; url: string; durationSec: number | null } | null;
  }
): Promise<{ id: number; url: string; durationSec: number | null }> {
  if (announcement.track) return announcement.track;

  if (announcement.source !== "TTS" || !announcement.text?.trim()) {
    throw new Error("Durchsage hat weder Audiodatei noch Ansagetext");
  }

  const track = await renderTtsTrack(
    db,
    accountId,
    announcement.text,
    announcement.voice
  );

  await db.audioAnnouncement.update({
    where: { id: announcement.id },
    data: { trackId: track.id },
  });

  return track;
}

/** Aufräumen: erledigte Jobs einer Zone, damit die Queue nicht ausufert. */
export async function pruneFinishedJobs(zoneId: number, keep = 200): Promise<void> {
  const cutoff = await prisma.audioJob.findMany({
    where: { zoneId, status: { in: ["DONE", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    skip: keep,
    take: 1,
    select: { createdAt: true },
  });
  if (cutoff.length === 0) return;
  await prisma.audioJob.deleteMany({
    where: {
      zoneId,
      status: { in: ["DONE", "FAILED"] },
      createdAt: { lte: cutoff[0].createdAt },
    },
  });
}
