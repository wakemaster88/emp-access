/**
 * Monitor-Seite als Abspieler einer Audio-Zone: reine Regeln für Browser, API
 * und Tests – ohne Server- und ohne Browser-Importe.
 *
 * Der Monitor verhält sich wie ein Audio-Pi (`raspberry-pi/emp_audio/main.py`):
 * Er holt alle paar Sekunden Zone und Jobs ab, spielt Durchsagen mit Vorrang
 * und gesenkter Musik, startet und stoppt Musik und hält die Musik-Automatik
 * ein. Anders als ein Pi spielt er nur, wenn auf genau diesem Gerät jemand
 * „Hier abspielen“ getippt hat, und der Browser gibt Ton erst nach einem Tippen
 * frei (Autoplay-Sperre).
 */

/** Abruf, solange das Gerät spielt (wie der Pi). */
export const MONITOR_AUDIO_POLL_MS = 8_000;
/** Abruf, solange nur gefragt wird, ob der Monitor eine Zone hat. */
export const MONITOR_AUDIO_IDLE_POLL_MS = 60_000;
/** Heartbeat wie beim Pi; offline gilt erst nach 5 Minuten. */
export const MONITOR_AUDIO_HEARTBEAT_MS = 60_000;
/**
 * Ältere Befehle spielt ein Monitor nicht mehr, sie gehen als FAILED in den
 * Verlauf. Ein Monitor, der läuft, holt sie nach Sekunden ab; eine Durchsage
 * vom Morgen, die nachmittags beim ersten Öffnen der Seite käme, hilft
 * niemandem.
 */
export const MONITOR_AUDIO_JOB_MAX_AGE_MS = 2 * 60_000;
/** Ab dieser Priorität unterbricht eine Durchsage eine laufende (wie am Pi). */
export const MONITOR_AUDIO_EMERGENCY_PRIORITY = 100;

/** Meldung an der Zone, solange der Browser den Ton noch sperrt. */
export const MONITOR_AUDIO_LOCKED_MESSAGE =
  "Ton am Monitor gesperrt – dort einmal auf den Bildschirm tippen";

/** Wahl je Gerät: spielt dieses Gerät die Zone des Monitors? */
export type MonitorAudioDecision = "on" | "off";

export function monitorAudioStorageKey(token: string): string {
  return `emp-monitor-ton:${token}`;
}

/**
 * `?ton=an` bzw. `?ton=aus` im Link setzt die Wahl für dieses Gerät, etwa um
 * sie zurückzunehmen. null = kein Parameter.
 */
export function decisionFromSearch(search: string): MonitorAudioDecision | null {
  const value = new URLSearchParams(search).get("ton")?.trim().toLowerCase();
  if (value === "an" || value === "ein" || value === "1" || value === "on") return "on";
  if (value === "aus" || value === "0" || value === "off") return "off";
  return null;
}

export function parseDecision(value: string | null | undefined): MonitorAudioDecision | null {
  return value === "on" || value === "off" ? value : null;
}

// ── Zone und Jobs vom Server ───────────────────────────────────────────────

export interface MonitorTrack {
  id?: number;
  title: string;
  url: string;
}

export interface MonitorZoneState {
  id: number;
  name: string;
  isActive: boolean;
  volume: number;
  announcementVolume: number;
  duckVolume: number;
  sourceKind: "SILENCE" | "PLAYLIST" | "STREAM";
  streamUrl: string | null;
  music?: { allowed?: boolean; until?: string | null } | null;
  playlist: { id: number; name: string; shuffle: boolean; tracks: MonitorTrack[] } | null;
}

export interface MonitorJob {
  id: number;
  kind: string;
  payload: unknown;
  createdAt?: string;
}

/**
 * Musik nur im Fenster: `music.allowed` gilt bis `music.until`, danach das
 * Gegenteil – so hält der Monitor das Fenster auch zwischen zwei Abrufen ein.
 * Ohne `music` ist Musik erlaubt (wie am Pi).
 */
export function musicBlocked(zone: Pick<MonitorZoneState, "music">, nowMs: number): boolean {
  const music = zone.music;
  if (!music || typeof music !== "object") return false;
  let allowed = music.allowed !== false;
  const until = typeof music.until === "string" ? Date.parse(music.until) : Number.NaN;
  if (Number.isFinite(until) && nowMs >= until) allowed = !allowed;
  return !allowed;
}

function record(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function jobPriority(job: MonitorJob): number {
  return int(record(job.payload).priority) ?? 0;
}

/** Notfalldurchsagen dürfen nicht hinter einer laufenden Ansage warten. */
export function interruptsSpeech(job: MonitorJob): boolean {
  return (
    (job.kind === "ANNOUNCE" || job.kind === "LIVE") &&
    jobPriority(job) >= MONITOR_AUDIO_EMERGENCY_PRIORITY
  );
}

/** Braucht der Job Ton? Solange der Browser sperrt, scheitern genau diese. */
export function jobNeedsSound(kind: string): boolean {
  return kind === "ANNOUNCE" || kind === "LIVE" || kind === "PLAY";
}

/**
 * Warteschlange wie am Pi: höhere Priorität zuerst, sonst in Ankunftsfolge.
 * Ein Job kommt nur einmal hinein, auch wenn er zweimal geliefert wird.
 */
export class MonitorJobQueue {
  private items: { job: MonitorJob; priority: number; seq: number }[] = [];
  private seen = new Set<number>();
  private seq = 0;

  /** false, wenn der Job schon bekannt war. */
  push(job: MonitorJob): boolean {
    if (!Number.isInteger(job.id) || this.seen.has(job.id)) return false;
    this.seen.add(job.id);
    if (this.seen.size > 500) {
      // IDs steigen, die ältesten können gefahrlos vergessen werden.
      for (const old of [...this.seen].sort((a, b) => a - b).slice(0, 250)) this.seen.delete(old);
    }
    this.items.push({ job, priority: jobPriority(job), seq: this.seq++ });
    return true;
  }

  pop(): MonitorJob | null {
    if (this.items.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.items.length; i++) {
      const a = this.items[i];
      const b = this.items[best];
      if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    return this.items.splice(best, 1)[0].job;
  }

  get size(): number {
    return this.items.length;
  }
}

export interface AnnounceBed {
  url: string;
  untilSec: number;
  level: number;
}

export interface AnnounceRequest {
  url: string;
  chime: boolean;
  repeat: number;
  bed: AnnounceBed | null;
}

/** Wie am Pi: Musik unter der Durchsage läuft 4 bis 60 Sekunden. */
const BED_MIN_SECONDS = 4;
const BED_MAX_SECONDS = 60;

export function parseAnnounce(payload: unknown): AnnounceRequest | { error: string } {
  const p = record(payload);
  if (typeof p.url !== "string" || !p.url) return { error: "Durchsage ohne Audiodatei" };
  const repeat = int(p.repeat);
  const rawBed = record(p.bed);
  const until = typeof rawBed.untilSec === "number" ? rawBed.untilSec : 0;
  const bed =
    typeof rawBed.url === "string" && rawBed.url && until > 0
      ? {
          url: rawBed.url,
          untilSec: Math.max(BED_MIN_SECONDS, Math.min(BED_MAX_SECONDS, until)),
          level:
            typeof rawBed.level === "number" ? Math.max(0.05, Math.min(1, rawBed.level)) : 0.8,
        }
      : null;
  return {
    url: p.url,
    chime: p.chime === true,
    repeat: Math.max(1, Math.min(10, repeat ?? 1)),
    bed,
  };
}

export type MusicSource =
  | { kind: "STREAM"; url: string }
  | { kind: "PLAYLIST"; tracks: MonitorTrack[]; shuffle: boolean };

function tracksOf(value: unknown): MonitorTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((t) => {
    const r = record(t);
    return typeof r.url === "string" && r.url
      ? [{ id: int(r.id) ?? undefined, title: typeof r.title === "string" ? r.title : "", url: r.url }]
      : [];
  });
}

/** Was ein PLAY-Job abspielen soll; `manual` geht vor der Musik-Automatik. */
export function parsePlay(
  payload: unknown
): { source: MusicSource; volume: number | null; manual: boolean } | { error: string } {
  const p = record(payload);
  const volume = int(p.volume);
  const manual = p.manual === true;
  if (p.kind === "STREAM") {
    if (typeof p.url !== "string" || !p.url) return { error: "Stream ohne URL" };
    return { source: { kind: "STREAM", url: p.url }, volume, manual };
  }
  const tracks = tracksOf(p.tracks);
  if (tracks.length === 0) return { error: "Keine abspielbaren Titel in der Playlist" };
  return { source: { kind: "PLAYLIST", tracks, shuffle: p.shuffle === true }, volume, manual };
}

/** Die Quelle, mit der die Zone nach dem Laden oder zum Fensterbeginn weiterspielt. */
export function zoneSource(zone: MonitorZoneState): MusicSource | null {
  if (zone.sourceKind === "STREAM" && zone.streamUrl) return { kind: "STREAM", url: zone.streamUrl };
  if (zone.sourceKind === "PLAYLIST" && zone.playlist) {
    const tracks = tracksOf(zone.playlist.tracks);
    if (tracks.length > 0) return { kind: "PLAYLIST", tracks, shuffle: zone.playlist.shuffle };
  }
  return null;
}

/** Abspielfolge einer Playlist; `random` nur für Tests austauschbar. */
export function playOrder(count: number, shuffle: boolean, random: () => number = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  if (!shuffle) return order;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Lautstärke 0–100 der Zone als Pegel des Audio-Elements (wie beim Mithören). */
export function elementVolume(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(1, percent / 100));
}

/** Rohes PCM (16 Bit little-endian, mono) der Live-Durchsage als Float-Samples. */
export function pcm16ToFloat32(bytes: ArrayBuffer | Uint8Array): Float32Array {
  const view =
    bytes instanceof Uint8Array
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new DataView(bytes);
  const count = Math.floor(view.byteLength / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/**
 * Gong vor der Durchsage als WAV – derselbe Zweiklang wie am Pi
 * (`raspberry-pi/emp_audio/chime.py`): a'' und d''' mit Ausklingen.
 */
export function chimeWav(sampleRate = 44_100): Uint8Array {
  const tones: [number, number][] = [
    [880.0, 0.28],
    [1174.7, 0.45],
  ];
  const amplitude = 0.35;
  const samples: number[] = [];
  for (const [frequency, duration] of tones) {
    const total = Math.floor(sampleRate * duration);
    for (let i = 0; i < total; i++) {
      const decay = Math.exp((-3.5 * i) / total);
      samples.push(amplitude * decay * Math.sin((2 * Math.PI * frequency * i) / sampleRate));
    }
  }
  return pcmWav(samples, sampleRate);
}

/** Kurze Stille als WAV: damit gibt ein Tippen die Audio-Elemente frei. */
export function silentWav(sampleRate = 8_000, seconds = 0.1): Uint8Array {
  return pcmWav(new Array(Math.floor(sampleRate * seconds)).fill(0), sampleRate);
}

function pcmWav(samples: number[], sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
  return new Uint8Array(buffer);
}
