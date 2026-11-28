/**
 * Monitor als Abspieler einer Audio-Zone: Abruf, Jobs und Heartbeat – wie der
 * Audio-Pi (`raspberry-pi/emp_audio/main.py`), nur im Browser.
 *
 * Ablauf
 * 1. Ohne Wahl auf diesem Gerät nur nachsehen, ob der Monitor eine Zone hat
 *    (holt keine Jobs ab) und „Hier abspielen?“ anbieten.
 * 2. Mit „Hier abspielen“ alle 8 s Zone und Jobs holen, Musik und Durchsagen
 *    abspielen, Status melden. „Nicht hier“ merkt sich das Gerät ebenfalls.
 * 3. Sperrt der Browser den Ton (nach jedem Neuladen ohne Tippen), scheitern
 *    Durchsagen und Start mit einem klaren Grund, bis jemand tippt.
 */
import {
  MONITOR_AUDIO_HEARTBEAT_MS,
  MONITOR_AUDIO_IDLE_POLL_MS,
  MONITOR_AUDIO_LOCKED_MESSAGE,
  MONITOR_AUDIO_POLL_MS,
  MonitorJobQueue,
  decisionFromSearch,
  interruptsSpeech,
  jobNeedsSound,
  monitorAudioStorageKey,
  musicBlocked,
  parseAnnounce,
  parseDecision,
  parsePlay,
  zoneSource,
  type MonitorAudioDecision,
  type MonitorJob,
  type MonitorZoneState,
} from "@/lib/monitor-audio";
import { MonitorSound, type LiveChunk } from "./monitor-sound";

export type MonitorAudioMode = "hidden" | "ask" | "locked" | "playing";

/** So lange gilt ein eben getipptes Stumm vor dem Serverstand. */
const MUTE_OVERRIDE_MS = 15_000;

export interface MonitorAudioView {
  mode: MonitorAudioMode;
  zoneName: string | null;
}

interface JobReport {
  id: number;
  status: "PLAYING" | "DONE" | "FAILED";
  errorMessage?: string;
}

function readDecision(token: string): MonitorAudioDecision | null {
  try {
    return parseDecision(window.localStorage.getItem(monitorAudioStorageKey(token)));
  } catch {
    return null;
  }
}

function saveDecision(token: string, decision: MonitorAudioDecision): void {
  try {
    window.localStorage.setItem(monitorAudioStorageKey(token), decision);
  } catch {
    // Privates Fenster o. Ä.: gilt dann nur bis zum Neuladen.
  }
}

export class MonitorAudioPlayer {
  private sound: MonitorSound | null = null;
  private decision: MonitorAudioDecision | null = null;
  private zone: MonitorZoneState | null = null;
  private previewName: string | null = null;
  private etag: string | null = null;
  private pollTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private stateTimer: number | null = null;
  private queue = new MonitorJobQueue();
  private working = false;
  private restored = false;
  private offHours = false;
  private reports: JobReport[] = [];
  /** Laufende Meldung; Meldungen gehen nacheinander raus, sonst überholt „läuft“ ein „fertig“. */
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private disposed = false;
  private lastView = "";
  /** Ein Abruf läuft; ein weiterer (refresh) kommt gleich danach. */
  private polling = false;
  private pollQueued = false;
  /**
   * Stumm, eben am Monitor getippt: gilt kurz vor dem Serverstand, damit ein
   * Abruf, der vor dem Tippen losging, die Musik nicht kurz wieder aufdreht.
   */
  private muteOverride: { muted: boolean; until: number } | null = null;

  constructor(
    private readonly token: string,
    private readonly onView: (view: MonitorAudioView) => void
  ) {}

  private get base(): string {
    return `/api/monitor-audio/${encodeURIComponent(this.token)}`;
  }

  start(): void {
    const fromLink = decisionFromSearch(window.location.search);
    if (fromLink) saveDecision(this.token, fromLink);
    this.decision = fromLink ?? readDecision(this.token);
    if (this.decision === "off") return this.emit();
    if (this.decision === "on") this.beginPlaying();
    else void this.pollPreview();
  }

  /** „Hier abspielen“ – im Tippen aufrufen, das gibt zugleich den Ton frei. */
  accept(): void {
    saveDecision(this.token, "on");
    this.decision = "on";
    // Gibt den Ton frei: beginPlaying() ruft play() noch innerhalb des Tippens.
    this.beginPlaying();
  }

  /** „Nicht hier“: dieses Gerät bleibt still und fragt nicht mehr. */
  decline(): void {
    saveDecision(this.token, "off");
    this.decision = "off";
    this.clearTimers();
    this.sound?.dispose();
    this.sound = null;
    this.zone = null;
    this.emit();
  }

  /** Irgendein Tippen auf die Seite, solange der Ton gesperrt ist. */
  unlock(): void {
    const sound = this.sound;
    if (!sound || sound.unlocked || this.decision !== "on") return;
    void sound.unlockInGesture().then((ok) => ok && this.onUnlocked());
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.sound?.dispose();
    this.sound = null;
  }

  // ── Taste „Audio“ am Monitor ─────────────────────────────────────────

  /** Spielt dieses Gerät die Zone gerade hörbar ab? */
  get playsHere(): boolean {
    return this.decision === "on" && !!this.zone && !!this.sound?.unlocked;
  }

  /** Stumm sofort hier umsetzen; der Server bekommt es parallel über die Taste. */
  setMusicMuted(muted: boolean): void {
    this.muteOverride = { muted, until: Date.now() + MUTE_OVERRIDE_MS };
    this.sound?.setMusicMuted(muted);
  }

  /** Lautstärke sofort hier; der Befehl dazu kommt mit dem nächsten Abruf. */
  previewVolume(volume: number): void {
    if (this.decision === "on") this.sound?.setVolume(volume);
  }

  /** Gleich abrufen statt bis zu 8 s zu warten – nach Start/Stopp an der Taste. */
  refresh(): void {
    if (this.disposed || this.decision !== "on") return;
    if (this.polling) {
      this.pollQueued = true;
      return;
    }
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    void this.poll();
  }

  private musicMutedFor(zone: MonitorZoneState): boolean {
    const override = this.muteOverride;
    if (override && Date.now() < override.until) return override.muted;
    this.muteOverride = null;
    return zone.musicMuted === true;
  }

  // ── Zustand für die Anzeige ───────────────────────────────────────────

  private emit(): void {
    if (this.disposed) return;
    const view: MonitorAudioView =
      this.decision === "on"
        ? {
            mode: !this.zone ? "hidden" : this.sound?.unlocked ? "playing" : "locked",
            zoneName: this.zone?.name ?? null,
          }
        : this.decision === null && this.previewName
          ? { mode: "ask", zoneName: this.previewName }
          : { mode: "hidden", zoneName: null };
    const key = `${view.mode}|${view.zoneName}`;
    if (key === this.lastView) return;
    this.lastView = key;
    this.onView(view);
  }

  private ensureSound(): MonitorSound {
    if (!this.sound) {
      const sound = new MonitorSound();
      sound.onState = () => this.stateChanged();
      sound.onLocked = () => this.emit();
      this.sound = sound;
    }
    return this.sound;
  }

  private onUnlocked(): void {
    this.emit();
    // Was beim Laden gesperrt war, jetzt nachholen.
    if (this.zone) this.applyZone(this.zone);
    this.stateChanged();
  }

  private clearTimers(): void {
    for (const timer of [this.pollTimer, this.heartbeatTimer, this.stateTimer]) {
      if (timer !== null) window.clearTimeout(timer);
    }
    this.pollTimer = this.heartbeatTimer = this.stateTimer = null;
  }

  // ── Vorschau: hat der Monitor eine Zone? ──────────────────────────────

  private async pollPreview(): Promise<void> {
    if (this.disposed || this.decision !== null) return;
    try {
      const res = await fetch(this.base, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { zone?: { name?: string } | null };
        this.previewName = typeof body.zone?.name === "string" ? body.zone.name : null;
      } else if (res.status === 404) {
        this.previewName = null;
      }
    } catch {
      // Netz weg: beim nächsten Mal.
    }
    this.emit();
    if (this.disposed || this.decision !== null) return;
    this.pollTimer = window.setTimeout(() => void this.pollPreview(), MONITOR_AUDIO_IDLE_POLL_MS);
  }

  // ── Spielen ───────────────────────────────────────────────────────────

  private beginPlaying(): void {
    this.clearTimers();
    const sound = this.ensureSound();
    // Ohne Tippen prüfen, ob der Browser schon darf (Kiosk-Modus, installierte App,
    // Website-Einstellung „Automatisch abspielen“).
    if (!sound.unlocked) void sound.unlockInGesture().then((ok) => ok && this.onUnlocked());
    void this.poll();
    this.scheduleHeartbeat();
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.decision !== "on") return;
    this.polling = true;
    try {
      const res = await fetch(`${this.base}?spielen=1`, {
        cache: "no-store",
        headers: this.etag ? { "If-None-Match": this.etag } : undefined,
      });
      if (res.status === 304) {
        if (this.zone) this.applyZone(this.zone);
      } else if (res.ok) {
        this.etag = res.headers.get("ETag");
        const body = (await res.json()) as { zone: MonitorZoneState | null; jobs?: MonitorJob[] };
        if (body.zone) {
          const first = !this.zone;
          // Erst die Zone (läuft sofort durch), dann die Jobs: sie brauchen sie.
          this.applyZone(body.zone);
          this.enqueue(body.jobs ?? []);
          // Gleich melden, sonst stünde die Zone bis zum Heartbeat noch auf „Offline“.
          if (first) this.stateChanged(true);
        } else {
          this.clearZone();
        }
      } else if (res.status === 404) {
        this.clearZone();
      }
    } catch {
      // Netz weg: Musik läuft weiter, Fenster hält `music.until` ein.
      if (this.zone) this.applyZone(this.zone);
    } finally {
      this.polling = false;
    }
    if (this.disposed || this.decision !== "on") return;
    if (this.pollQueued) {
      this.pollQueued = false;
      void this.poll();
      return;
    }
    this.pollTimer = window.setTimeout(
      () => void this.poll(),
      this.zone ? MONITOR_AUDIO_POLL_MS : MONITOR_AUDIO_IDLE_POLL_MS
    );
  }

  private clearZone(): void {
    if (this.zone) this.sound?.stopMusic();
    this.zone = null;
    this.restored = false;
    this.offHours = false;
    this.emit();
  }

  /** Zonenstand übernehmen – dieselben Regeln wie `_apply_zone` am Pi. */
  private applyZone(zone: MonitorZoneState): void {
    const previous = this.zone;
    this.zone = zone;
    this.emit();
    const sound = this.sound;
    if (!sound) return;
    // Stumm betrifft nur die Musik; Durchsagen laufen über eigene Elemente.
    sound.setMusicMuted(this.musicMutedFor(zone));

    if (!zone.isActive) {
      if (sound.isPlaying) sound.stopMusic();
      return;
    }
    if (zone.volume !== sound.musicVolume) sound.setVolume(zone.volume);

    this.enforceMusicWindow(zone, sound);
    if (this.offHours || !sound.unlocked) return;

    if (!this.restored) {
      this.restored = true;
      this.restore(zone, sound);
    } else if (previous && previous.id !== zone.id) {
      this.restore(zone, sound);
    }
  }

  /** Musik nur im Fenster: stoppen, wenn es zugeht, und fortsetzen, wenn es aufgeht. */
  private enforceMusicWindow(zone: MonitorZoneState, sound: MonitorSound): void {
    if (musicBlocked(zone, Date.now())) {
      if (sound.isPlaying) sound.stopMusic();
      this.offHours = true;
      this.restored = true;
      return;
    }
    if (this.offHours) {
      this.offHours = false;
      // Gesperrt: nach dem Tippen fortsetzen (applyZone startet dann die Quelle).
      if (sound.unlocked) this.restore(zone, sound);
      else this.restored = false;
    }
  }

  private restore(zone: MonitorZoneState, sound: MonitorSound): void {
    if (musicBlocked(zone, Date.now())) {
      this.offHours = true;
      return;
    }
    const source = zoneSource(zone);
    if (source) void sound.playSource(source).catch(() => {});
  }

  // ── Jobs ──────────────────────────────────────────────────────────────

  private enqueue(jobs: MonitorJob[]): void {
    for (const job of jobs) {
      if (!this.queue.push(job)) continue;
      if (interruptsSpeech(job)) this.sound?.interruptSpeech();
    }
    void this.work();
  }

  private async work(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      for (let job = this.queue.pop(); job; job = this.queue.pop()) {
        if (this.disposed) return;
        await this.run(job);
      }
    } finally {
      this.working = false;
    }
  }

  private async run(job: MonitorJob): Promise<void> {
    const sound = this.sound;
    if (!sound || this.decision !== "on") return;
    if (jobNeedsSound(job.kind) && !sound.unlocked) {
      this.report({ id: job.id, status: "FAILED", errorMessage: MONITOR_AUDIO_LOCKED_MESSAGE });
      return;
    }
    // Eine Live-Durchsage meldet sich erst nach dem Gong als laufend.
    if (job.kind !== "LIVE") this.report({ id: job.id, status: "PLAYING" });
    try {
      await this.handle(job, sound);
      this.report({ id: job.id, status: "DONE" });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Wiedergabe fehlgeschlagen";
      this.report({ id: job.id, status: "FAILED", errorMessage: message });
    }
  }

  private async handle(job: MonitorJob, sound: MonitorSound): Promise<void> {
    const zone = this.zone;
    if (!zone) throw new Error("Keine Zone");
    if (!zone.isActive) throw new Error("Zone ist deaktiviert");

    switch (job.kind) {
      case "ANNOUNCE": {
        const req = parseAnnounce(job.payload);
        if ("error" in req) throw new Error(req.error);
        const done = await sound.announce(req, zone.announcementVolume ?? 80, zone.duckVolume ?? 20);
        if (!done) throw new Error("Durch höher priorisierte Durchsage unterbrochen");
        return;
      }
      case "LIVE": {
        const sessionId = (job.payload as { sessionId?: unknown } | null)?.sessionId;
        if (typeof sessionId !== "number" || !Number.isInteger(sessionId)) {
          throw new Error("Live-Durchsage ohne Sitzung");
        }
        const chime = (job.payload as { chime?: unknown }).chime !== false;
        const done = await sound.live((after) => this.fetchLive(sessionId, after), {
          volume: zone.announcementVolume ?? 80,
          duckVolume: zone.duckVolume ?? 20,
          chime,
          onStart: () => this.report({ id: job.id, status: "PLAYING" }),
        });
        if (!done) throw new Error("Durch höher priorisierte Durchsage unterbrochen");
        return;
      }
      case "PLAY": {
        const play = parsePlay(job.payload);
        if ("error" in play) throw new Error(play.error);
        if (play.volume !== null) sound.setVolume(play.volume);
        // Ein manuelles Play geht vor der Musik-Automatik; ein Zeitplan nicht.
        if (musicBlocked(zone, Date.now()) && !play.manual) {
          this.offHours = true;
          throw new Error("Außerhalb der Musikzeit – nicht gestartet");
        }
        this.offHours = false;
        this.restored = true;
        try {
          await sound.playSource(play.source);
        } finally {
          this.stateChanged(true);
        }
        return;
      }
      case "STOP":
        sound.stopMusic();
        this.stateChanged(true);
        return;
      case "VOLUME": {
        const volume = (job.payload as { volume?: unknown } | null)?.volume;
        if (typeof volume !== "number" || !Number.isInteger(volume)) throw new Error("Lautstärke fehlt");
        sound.setVolume(volume);
        return;
      }
      case "SYNC_LIBRARY":
        // Der Browser lädt Titel erst beim Abspielen; nichts vorzuhalten.
        return;
      default:
        throw new Error(`Unbekannter Job-Typ: ${job.kind}`);
    }
  }

  private async fetchLive(sessionId: number, after: number | null): Promise<LiveChunk | null> {
    const query = new URLSearchParams({ session: String(sessionId) });
    if (after !== null) query.set("after", String(after));
    try {
      const res = await fetch(`${this.base}/live?${query}`, { cache: "no-store" });
      if (!res.ok) return null;
      return {
        data: await res.arrayBuffer(),
        state: res.headers.get("X-Live-State") === "ENDED" ? "ENDED" : "LIVE",
        seq: Number(res.headers.get("X-Live-Seq")) || 0,
        rate: Number(res.headers.get("X-Live-Rate")) || 16_000,
      };
    } catch {
      return null;
    }
  }

  // ── Meldungen ─────────────────────────────────────────────────────────

  private report(report: JobReport): void {
    this.reports.push(report);
    void this.flush();
  }

  /** Wiedergabe begann/endete: bald melden, damit die Zonenkarte stimmt. */
  private stateChanged(now = false): void {
    if (this.stateTimer !== null) window.clearTimeout(this.stateTimer);
    this.stateTimer = window.setTimeout(() => {
      this.stateTimer = null;
      void this.flush();
    }, now ? 0 : 1_500);
  }

  private scheduleHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = window.setTimeout(() => {
      this.heartbeatTimer = null;
      void this.flush().finally(() => {
        if (!this.disposed && this.decision === "on") this.scheduleHeartbeat();
      });
    }, MONITOR_AUDIO_HEARTBEAT_MS);
  }

  private flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = this.send().finally(() => {
      this.flushing = null;
      if (this.flushAgain) {
        this.flushAgain = false;
        void this.flush();
      }
    });
    return this.flushing;
  }

  private async send(): Promise<void> {
    const sound = this.sound;
    if (this.disposed || !sound || !this.zone || this.decision !== "on") return;
    const jobs = this.reports.splice(0, this.reports.length);
    try {
      const res = await fetch(this.base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPlaying: sound.isPlaying,
          currentTitle: sound.currentTitle,
          volume: sound.musicVolume,
          jobs,
        }),
      });
      // 404: Zone wurde gerade abgehängt – Meldungen sind dann gegenstandslos.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
    } catch {
      // Beim nächsten Heartbeat noch einmal; nicht unbegrenzt sammeln.
      this.reports.unshift(...jobs.slice(-50));
    }
  }
}
