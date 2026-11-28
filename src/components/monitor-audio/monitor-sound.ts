/**
 * Ton im Browser für den Monitor, der eine Audio-Zone abspielt: Musik
 * (Playlist oder Webradio), Durchsagen mit Gong, gesenkter Musik und Musik
 * darunter, Live-Durchsagen über Web Audio.
 *
 * Feste Audio-Elemente statt immer neuer: Safari gibt jedes Element einzeln
 * frei, und nur in einem Tippen. `unlockInGesture()` spielt deshalb kurz Stille
 * auf jedem Element ab; danach dürfen sie ohne weiteres Tippen spielen.
 */
import {
  MONITOR_AUDIO_LOCKED_MESSAGE,
  chimeWav,
  elementVolume,
  pcm16ToFloat32,
  playOrder,
  silentWav,
  type AnnounceBed,
  type AnnounceRequest,
  type MusicSource,
} from "@/lib/monitor-audio";

/** Wie am Pi: Sprache setzt 1,5 s nach der Musik ein, die Musik klingt 2,5 s aus. */
const BED_SPEECH_DELAY_MS = 1_500;
const BED_FADE_OUT_MS = 2_500;
/** Musik unter der Sprache: Anteil am Pegel der Musik (wie in der Vorschau). */
const BED_UNDER_SPEECH = 0.2;
/** Webradio bricht ab oder lädt nicht: so lange warten bis zum nächsten Versuch. */
const STREAM_RETRY_MS = 10_000;
/** Kein Ende in Sicht (Netz hängt): spätestens dann gilt eine Datei als fertig. */
const MAX_FILE_MS = 15 * 60_000;
/** Kommt so lange kein Ton vom Server, gilt eine Live-Durchsage als verloren (wie am Pi). */
const LIVE_GIVE_UP_MS = 15_000;

export interface LiveChunk {
  data: ArrayBuffer;
  state: "LIVE" | "ENDED";
  seq: number;
  rate: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done);
  });
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String(error.name) : "";
}

export class MonitorSound {
  private readonly music = new Audio();
  private readonly speech = new Audio();
  private readonly bed = new Audio();
  private ctx: AudioContext | null = null;
  private readonly chimeUrl: string;
  private readonly silentUrl: string;

  private source: MusicSource | null = null;
  private order: number[] = [];
  private position = 0;
  /** Titel in Folge, die nicht spielten – alle kaputt: aufhören statt kreiseln. */
  private failures = 0;
  private starting = false;
  private retryTimer: number | null = null;

  private volume = 50;
  private duckLevel = 15;
  private ducked = false;
  /** Musik lautlos (Taste „Audio“); Durchsagen, Gong und Live-Ton laufen über eigene Wege. */
  private musicMuted = false;
  private speechAbort: AbortController | null = null;

  /** Darf der Browser hier Ton abspielen? */
  unlocked = false;
  /** Wiedergabe begann oder endete – der Heartbeat soll es bald melden. */
  onState: (() => void) | null = null;
  /** Der Browser sperrt wieder (z. B. nach dem Aufwachen aus dem Ruhezustand). */
  onLocked: (() => void) | null = null;

  constructor() {
    this.chimeUrl = URL.createObjectURL(new Blob([chimeWav() as BlobPart], { type: "audio/wav" }));
    this.silentUrl = URL.createObjectURL(new Blob([silentWav() as BlobPart], { type: "audio/wav" }));
    for (const el of [this.music, this.speech, this.bed]) el.preload = "auto";

    this.music.addEventListener("ended", () => this.advance());
    this.music.addEventListener("error", () => {
      if (!this.starting) this.advance(true);
    });
    this.music.addEventListener("playing", () => this.onState?.());
    this.music.addEventListener("pause", () => this.onState?.());
  }

  // ── Freigabe ───────────────────────────────────────────────────────────

  /**
   * Im Tippen aufrufen (oder ohne, um zu prüfen, ob der Browser schon darf):
   * `play()` muss synchron im Ereignis passieren, sonst zählt es nicht.
   */
  unlockInGesture(): Promise<boolean> {
    const attempts: Promise<void>[] = [];
    for (const el of [this.speech, this.bed, this.music]) {
      // Was gerade spielt, ist schon frei – nicht unterbrechen.
      if (!el.paused) continue;
      if (el === this.music && this.source) continue;
      el.src = this.silentUrl;
      attempts.push(el.play().then(() => el.pause()));
    }
    // Web Audio braucht es nur für Live-Durchsagen; scheitert es, bleibt der Rest frei.
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
    return Promise.all(attempts).then(
      () => {
        this.unlocked = true;
        return true;
      },
      () => false
    );
  }

  private locked(): Error {
    if (this.unlocked) {
      this.unlocked = false;
      this.onLocked?.();
    }
    return new Error(MONITOR_AUDIO_LOCKED_MESSAGE);
  }

  // ── Musik ──────────────────────────────────────────────────────────────

  get isPlaying(): boolean {
    return this.source !== null && !this.music.paused;
  }

  get currentTitle(): string | null {
    if (this.source?.kind !== "PLAYLIST") return null;
    return this.source.tracks[this.order[this.position]]?.title || null;
  }

  get musicVolume(): number {
    return this.volume;
  }

  get isMusicMuted(): boolean {
    return this.musicMuted;
  }

  /**
   * Musik stumm: sie läuft lautlos weiter (Titelfolge, Stream, gemeldeter
   * Zustand bleiben), Durchsagen klingen über ihre eigenen Elemente wie immer.
   */
  setMusicMuted(muted: boolean): void {
    if (this.musicMuted === muted) return;
    this.musicMuted = muted;
    this.applyMusicVolume();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(volume)));
    this.applyMusicVolume();
  }

  private applyMusicVolume(): void {
    this.music.volume = elementVolume(this.ducked ? this.duckLevel : this.volume);
    // `muted` statt Pegel 0: Safari auf iPad/iPhone übergeht `volume`, nicht aber `muted`.
    this.music.muted = this.musicMuted;
  }

  private duck(level: number): void {
    this.duckLevel = Math.max(0, Math.min(100, Math.round(level)));
    this.ducked = true;
    this.applyMusicVolume();
  }

  private unduck(): void {
    this.ducked = false;
    this.applyMusicVolume();
  }

  /** Quelle starten. Wirft, wenn nichts davon im Browser spielt. */
  async playSource(source: MusicSource): Promise<void> {
    this.stopMusic();
    this.source = source;
    this.failures = 0;
    if (source.kind === "STREAM") {
      await this.start(source.url, "Webradio lässt sich im Browser nicht abspielen");
      return;
    }
    this.order = playOrder(source.tracks.length, source.shuffle);
    this.position = 0;
    // Einzelne kaputte Titel überspringen; erst wenn keiner spielt, ist es ein Fehler.
    for (let tried = 0; tried < source.tracks.length; tried++) {
      if (this.source !== source) return;
      try {
        await this.start(source.tracks[this.order[this.position]].url, "Titel lässt sich im Browser nicht abspielen");
        return;
      } catch (error) {
        if ((error as Error).message === MONITOR_AUDIO_LOCKED_MESSAGE) throw error;
        this.position = (this.position + 1) % this.order.length;
      }
    }
    this.stopMusic();
    throw new Error("Kein Titel der Playlist lässt sich im Browser abspielen");
  }

  private async start(url: string, failure: string): Promise<void> {
    this.starting = true;
    this.music.src = url;
    this.applyMusicVolume();
    try {
      await this.music.play();
      this.failures = 0;
    } catch (error) {
      const name = errorName(error);
      if (name === "AbortError") return; // durch einen neueren Start ersetzt
      if (name === "NotAllowedError") throw this.locked();
      throw new Error(failure);
    } finally {
      this.starting = false;
    }
  }

  /** Nächster Titel bzw. Webradio neu verbinden. */
  private advance(failed = false): void {
    const source = this.source;
    if (!source) return;
    if (source.kind === "STREAM") {
      // Sender weg oder Netz kurz aus: in Ruhe neu versuchen, solange die Zone spielen soll.
      this.clearRetry();
      this.retryTimer = window.setTimeout(() => {
        if (this.source === source) void this.start(source.url, "").catch(() => this.advance(true));
      }, STREAM_RETRY_MS);
      return;
    }
    if (failed && ++this.failures >= source.tracks.length) {
      this.stopMusic();
      return;
    }
    this.position = (this.position + 1) % this.order.length;
    // Nach einer Runde neu mischen, sonst hört man immer dieselbe Folge.
    if (this.position === 0) this.order = playOrder(source.tracks.length, source.shuffle);
    void this.start(source.tracks[this.order[this.position]].url, "").catch(() => {
      if (this.source === source) this.advance(true);
    });
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  stopMusic(): void {
    const wasPlaying = this.isPlaying;
    this.source = null;
    this.clearRetry();
    this.music.pause();
    // Ohne diesen Schritt lädt der Browser einen Stream im Hintergrund weiter.
    this.music.removeAttribute("src");
    this.music.load();
    if (wasPlaying) this.onState?.();
  }

  // ── Durchsagen ─────────────────────────────────────────────────────────

  /** Bricht eine laufende Durchsage ab (Notfall mit höherer Priorität). */
  interruptSpeech(): void {
    this.speechAbort?.abort();
  }

  /**
   * Spielt eine Durchsage ganz ab. false heißt: durch eine höher priorisierte
   * abgebrochen. Die Musik ist währenddessen abgesenkt und kommt danach
   * zuverlässig wieder hoch – auch im Fehlerfall.
   */
  async announce(req: AnnounceRequest, volume: number, duckVolume: number): Promise<boolean> {
    const abort = new AbortController();
    this.speechAbort = abort;
    const wasPlaying = this.isPlaying;
    this.duck(duckVolume);
    try {
      // Kurz warten, damit die Absenkung hörbar vor der Ansage liegt.
      if (wasPlaying) await sleep(300, abort.signal);
      if (req.chime) await this.playFile(this.speech, this.chimeUrl, volume, abort.signal);
      for (let index = 0; index < req.repeat; index++) {
        if (abort.signal.aborted) return false;
        if (index > 0) await sleep(600, abort.signal);
        if (index === 0 && req.bed) {
          await this.playWithBed(req.url, req.bed, volume, abort.signal);
        } else {
          await this.playFile(this.speech, req.url, volume, abort.signal);
        }
      }
      return !abort.signal.aborted;
    } finally {
      this.unduck();
      if (this.speechAbort === abort) this.speechAbort = null;
    }
  }

  /** Eine Datei auf einem Element bis zum Ende; ein Abbruch beendet sie still. */
  private playFile(el: HTMLAudioElement, url: string, volume: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let limit = window.setTimeout(finish, MAX_FILE_MS);
      const onDuration = () => {
        if (!Number.isFinite(el.duration) || el.duration <= 0) return;
        window.clearTimeout(limit);
        limit = window.setTimeout(finish, el.duration * 1000 + 15_000);
      };
      const onError = () => fail(new Error("Audiodatei konnte im Browser nicht abgespielt werden"));
      const onAbort = () => {
        el.pause();
        finish();
      };
      function cleanup() {
        window.clearTimeout(limit);
        el.removeEventListener("ended", finish);
        el.removeEventListener("error", onError);
        el.removeEventListener("durationchange", onDuration);
        signal.removeEventListener("abort", onAbort);
      }
      function finish() {
        cleanup();
        resolve();
      }
      function fail(error: Error) {
        cleanup();
        reject(error);
      }
      el.addEventListener("ended", finish);
      el.addEventListener("error", onError);
      el.addEventListener("durationchange", onDuration);
      signal.addEventListener("abort", onAbort);
      el.src = url;
      el.volume = elementVolume(volume);
      el.play().catch((error) => {
        const name = errorName(error);
        if (name === "NotAllowedError") fail(this.locked());
        else if (name !== "AbortError") onError();
      });
    });
  }

  /**
   * Sprache über Musik (Geburtstagsansage): Musik setzt ein, die Sprache 1,5 s
   * später, darunter läuft die Musik leise weiter und klingt zum Ende aus.
   */
  private async playWithBed(url: string, bed: AnnounceBed, volume: number, signal: AbortSignal): Promise<void> {
    const level = bed.level * elementVolume(volume);
    const startedAt = Date.now();
    const timers: number[] = [];
    let fading = false;
    this.bed.src = bed.url;
    this.bed.volume = level;
    const bedPlays = await this.bed.play().then(
      () => true,
      () => false
    );
    if (!bedPlays) {
      // Musik lädt nicht: Ansage ohne Musik, wie am Pi.
      await this.playFile(this.speech, url, volume, signal);
      return;
    }
    const untilMs = bed.untilSec * 1000;
    timers.push(
      window.setTimeout(() => {
        fading = true;
        const from = this.bed.volume;
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          timers.push(
            window.setTimeout(() => {
              this.bed.volume = Math.max(0, from * (1 - i / steps));
            }, (i * BED_FADE_OUT_MS) / steps)
          );
        }
      }, Math.max(0, untilMs - BED_FADE_OUT_MS))
    );
    try {
      await sleep(BED_SPEECH_DELAY_MS, signal);
      if (!fading) this.bed.volume = level * BED_UNDER_SPEECH;
      await this.playFile(this.speech, url, volume, signal);
      if (!fading) this.bed.volume = level;
      await sleep(Math.max(0, untilMs - (Date.now() - startedAt)), signal);
    } finally {
      timers.forEach((t) => window.clearTimeout(t));
      this.bed.pause();
    }
  }

  // ── Live-Durchsage ─────────────────────────────────────────────────────

  /**
   * Live-Durchsage: Ton vom Server holen und über Web Audio lückenlos
   * hintereinander abspielen. `onStart` meldet nach dem Gong „jetzt sprechen“.
   * false heißt: durch eine höher priorisierte Durchsage abgebrochen.
   */
  async live(
    fetchChunk: (after: number | null) => Promise<LiveChunk | null>,
    options: { volume: number; duckVolume: number; chime: boolean; onStart: () => void }
  ): Promise<boolean> {
    // Läuft die Durchsage noch? Ein Monitor, der den Job spät abholt, soll nicht
    // mit Gong in eine längst beendete Durchsage starten.
    let first: LiveChunk | null = null;
    const openDeadline = Date.now() + LIVE_GIVE_UP_MS;
    while (!first && Date.now() < openDeadline) {
      first = await fetchChunk(null);
      if (!first) await sleep(1_000);
    }
    if (!first) throw new Error("Server nicht erreichbar – Live-Durchsage verpasst");
    if (first.state === "ENDED") return true;

    try {
      this.ctx ??= new AudioContext();
    } catch {
      throw new Error("Dieser Browser kann keine Live-Durchsage abspielen");
    }
    const ctx = this.ctx;
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    if (ctx.state !== "running") throw this.locked();

    const abort = new AbortController();
    this.speechAbort = abort;
    const wasPlaying = this.isPlaying;
    this.duck(options.duckVolume);
    const gain = ctx.createGain();
    gain.gain.value = elementVolume(options.volume);
    gain.connect(ctx.destination);
    const sources: AudioBufferSourceNode[] = [];
    let nextTime = 0;

    const schedule = (chunk: LiveChunk) => {
      const samples = pcm16ToFloat32(chunk.data);
      if (samples.length === 0) return;
      const buffer = ctx.createBuffer(1, samples.length, chunk.rate);
      buffer.getChannelData(0).set(samples);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(gain);
      // Kleiner Vorlauf gegen Aussetzer, ohne die Verzögerung spürbar zu erhöhen.
      const at = Math.max(nextTime, ctx.currentTime + 0.25);
      node.start(at);
      nextTime = at + buffer.duration;
      sources.push(node);
      if (sources.length > 200) sources.splice(0, 100);
    };

    try {
      if (wasPlaying) await sleep(300, abort.signal);
      if (options.chime) await this.playFile(this.speech, this.chimeUrl, options.volume, abort.signal);
      options.onStart();

      // Nach dem Gong beim neuesten Stück einsteigen: man hört, was gerade gesagt wird.
      let after: number | null = null;
      let lastOk = Date.now();
      while (!abort.signal.aborted) {
        const chunk = await fetchChunk(after);
        if (!chunk) {
          if (Date.now() - lastOk > LIVE_GIVE_UP_MS) break;
          await sleep(500, abort.signal);
          continue;
        }
        lastOk = Date.now();
        after = chunk.seq;
        const hasAudio = chunk.data.byteLength > 0;
        if (hasAudio) schedule(chunk);
        if (chunk.state === "ENDED") break;
        // Ohne Ton hat der Server schon gewartet – sofort erneut fragen.
        if (hasAudio) await sleep(300, abort.signal);
      }
      // Was schon geplant ist, ausspielen lassen.
      if (!abort.signal.aborted) {
        await sleep(Math.max(0, (nextTime - ctx.currentTime) * 1000), abort.signal);
      }
      return !abort.signal.aborted;
    } finally {
      for (const node of sources) {
        try {
          node.stop();
        } catch {
          // schon zu Ende
        }
      }
      gain.disconnect();
      this.unduck();
      if (this.speechAbort === abort) this.speechAbort = null;
    }
  }

  // ── Ende ───────────────────────────────────────────────────────────────

  dispose(): void {
    this.interruptSpeech();
    this.stopMusic();
    for (const el of [this.speech, this.bed]) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    URL.revokeObjectURL(this.chimeUrl);
    URL.revokeObjectURL(this.silentUrl);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
