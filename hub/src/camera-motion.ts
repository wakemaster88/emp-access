/**
 * Kamera-Bewegungen fuer Personen: Schwenk-Kameras folgen (Tracking der
 * Kamera) bei geschlossenem Raum, Kameras mit Zoom-Objektiv machen eine
 * gezielte optische Nahaufnahme. Haelt je Kamera fest, wer sie bewegt (Hand > Regel >
 * Automatik), und bringt sie immer in die Grundstellung zurueck. Gelingt die
 * Rueckfahrt des Zooms nicht sofort, bleibt die Ausgangsstellung gemerkt, bis
 * sie gelungen ist.
 * Kamerabefehle kommen ueber den Treiber (Reolink in cameras.ts).
 */
import type { NormBox } from "./person-crop-rules.js";
import {
  CENTER_WAIT_MS,
  CLOSEUP_SKIP_PAUSE_MS,
  CLOSEUP_ZONE_MAX_MS,
  FOCUS_MS,
  FOLLOW_COOLDOWN_MS,
  FOLLOW_MAX_MS,
  GUARD_IDLE_MS,
  HAND_HOLD_MS,
  HOME_RETRY_MS,
  TRACK_OFF_RETRIES,
  TRACK_OFF_RETRY_MS,
  TRACK_RECHECK_MS,
  TRACK_RETRY_MS,
  ZOOM_RETURN_RETRY_MS,
  activeHold,
  closeUpBlocked,
  closeUpCacheUsable,
  followBlocked,
  followRoomBlocked,
  isAtHome,
  isCentered,
  largestBox,
  newMotionState,
  opticalFactor,
  opticalWorth,
  planCloseUp,
  posForMagnification,
  readTrackingCfg,
  roomLabel,
  shouldRestoreZoom,
  zoomReturnGivenUp,
  type FaceNeed,
  type FollowRoom,
  type MotionState,
  type ZoomRange,
} from "./camera-motion-rules.js";

export interface MotionCam {
  id: number;
  name: string;
  model: string | null;
  pan: boolean;
  zoom: boolean;
  zone: boolean;
}

export interface GuardInfo {
  supported: boolean;
  exists: boolean;
}

/** Laufende Bewegung, die ein Hub-Neustart zurueckstellen muss. */
export interface PersistedMove {
  cameraId: number;
  following: boolean;
  /** Tracking-Schalter, den der Hub eingeschaltet hat. */
  trackKey: string | null;
  /** Zoom-Position vor der Nahaufnahme. */
  zoomHome: number | null;
  /** Zoom-Positionen, die die Automatik in dieser Nahaufnahme angefahren hat. */
  zoomAuto?: number[];
  /**
   * Hand oder Regel hat uebernommen: Rueckfahrt fruehestens dann (ms) und nur,
   * wenn der Zoom noch auf einer Position der Automatik steht. null = sofort.
   */
  zoomHandUntil?: number | null;
  /** Kameraname fuer Log und Meldung. */
  name?: string;
}

export interface CloseUp {
  jpeg: Buffer;
  at: number;
  /** Vergroesserung gegenueber dem Bild vorher. */
  gain: number;
  persons: number;
  /** Personen auf `jpeg` (normiert), schon erkannt: Der Kopf-Ausschnitt braucht sie nicht neu. */
  boxes: NormBox[];
}

/** Ausgang einer Nahaufnahme; `faceSkip`: verzichtet, weil die Fahrt dem Gesicht nicht hilft. */
interface CloseUpOutcome {
  result: CloseUp | null;
  faceSkip: boolean;
}

const NO_CLOSEUP: CloseUpOutcome = { result: null, faceSkip: false };

export interface MotionDriver {
  now(): number;
  sleep(ms: number): Promise<void>;
  camera(id: number): Promise<MotionCam | null>;
  readZoom(id: number): Promise<ZoomRange>;
  writeZoom(id: number, pos: number): Promise<void>;
  /** GetAiCfg, roh. */
  readTracking(id: number): Promise<Record<string, unknown>>;
  /** SetAiCfg mit nur diesen Werten. */
  writeTracking(id: number, patch: Record<string, unknown>): Promise<void>;
  readGuard(id: number): Promise<GuardInfo>;
  guard(id: number, cmd: "toPos" | "setPos"): Promise<void>;
  presets(id: number): Promise<Array<{ id: number; name: string }>>;
  gotoPreset(id: number, presetId: number): Promise<void>;
  snap(id: number): Promise<Buffer>;
  persons(jpeg: Buffer): Promise<NormBox[] | null>;
  vehicleActive(id: number): boolean;
  /** Betriebszustand der Kamera fuer das Folgen (Raum, Uhrzeit, Nachtfenster, HUB_FOLLOW_ALWAYS). */
  followRoom(id: number): FollowRoom;
  save(moves: PersistedMove[]): Promise<void>;
  load(): Promise<PersistedMove[]>;
  log(msg: string): void;
  /** Warnung im Lagebild des Hubs (Hub-Ereignis). */
  warn(where: string, title: string, detail?: string): void;
  count(kind: "follow" | "camera", event: string, data?: Record<string, unknown>): void;
}

type Home = { kind: "guard" } | { kind: "preset"; id: number };

/** Zoom-Objektiv ausserhalb der Ausgangsstellung: Die Rueckfahrt steht noch aus. */
interface ZoomAway {
  name: string;
  /** Zoom-Position vor der Nahaufnahme. */
  home: number;
  /** Positionen, die die Automatik in dieser Nahaufnahme angefahren hat. */
  autos: number[];
  /** Hand oder Regel hat uebernommen: erst nach der Sperre und nur bei unveraenderter Position zurueck. */
  hand: boolean;
  /** Gescheiterte Rueckfahrten. */
  fails: number;
  /** Naechster Versuch in tick() fruehestens dann. */
  nextAt: number;
}

export class CameraMotion {
  private readonly states = new Map<number, MotionState>();
  private readonly homes = new Map<number, { home: Home | null; at: number }>();
  private readonly trackKeys = new Map<number, string>();
  private readonly zoomHomes = new Map<number, ZoomAway>();
  private readonly closeUps = new Map<number, { at: number; outcome: CloseUpOutcome | null; run: Promise<CloseUpOutcome> | null }>();
  private readonly queues = new Map<number, Promise<unknown>>();
  /** Kameras, deren Tracking startFollow gerade einschaltet (Befehl unterwegs). */
  private readonly engaging = new Set<number>();
  /** Kameras, deren Zoom returnZoom gerade zurueckfaehrt (Befehl unterwegs). */
  private readonly zoomMoving = new Set<number>();
  /**
   * Tracking des Hubs liess sich nicht ausschalten: gescheiterte Versuche und
   * Termin des naechsten gezaehlten Versuchs, je Kamera.
   */
  private readonly trackOff = new Map<number, { fails: number; nextAt: number }>();
  private readonly startedAt: number;
  private ready: Promise<void> = Promise.resolve();
  /** restore() laeuft: Regeln warten, bis das Zurueckstellen fertig ist. */
  private restoring = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly d: MotionDriver,
    private readonly opts: { follow: boolean; zoom: boolean }
  ) {
    this.startedAt = d.now();
  }

  isFollowing(id: number): boolean {
    return this.states.get(id)?.following ?? false;
  }

  /**
   * Kamera in Grundstellung (Zonen-Auswertungen duerfen Bilder nehmen). Nicht,
   * solange die Rueckfahrt des Zooms aussteht: Der Ausschnitt passt dann nicht
   * zu Flaechen und Mindestgroessen. Hat Hand oder Regel die Kamera, gilt wie
   * bei jeder Handsteuerung, was die Kamera zeigt.
   */
  atHome(id: number): boolean {
    const away = this.zoomHomes.get(id);
    if (away && !away.hand) return false;
    return this.settled(id);
  }

  /**
   * Keine Bewegung der Automatik im Gang (Folgen, Nahaufnahme, Fokus nach der
   * Rueckkehr). Anders als atHome() zaehlt eine ausstehende Rueckfahrt des
   * Zooms nicht: Bis zum naechsten Versuch faehrt das Objektiv nicht, Warten
   * aendert am Bild nichts (Kennzeichen-Burst).
   */
  settled(id: number): boolean {
    // Waehrend ein Versuch der Rueckfahrt unterwegs ist, faehrt das Objektiv.
    if (this.zoomMoving.has(id)) return false;
    const st = this.states.get(id);
    return !st || isAtHome(st, this.d.now());
  }

  waitAtHome(id: number, maxMs: number): Promise<boolean> {
    return this.waitUntil(() => this.atHome(id), maxMs);
  }

  waitSettled(id: number, maxMs: number): Promise<boolean> {
    return this.waitUntil(() => this.settled(id), maxMs);
  }

  private async waitUntil(ok: () => boolean, maxMs: number): Promise<boolean> {
    const until = this.d.now() + maxMs;
    while (!ok()) {
      if (this.d.now() >= until) return false;
      await this.d.sleep(500);
    }
    return true;
  }

  /**
   * Steigende PERSON-Flanke: Schwenk-Kamera folgen lassen, nur bei
   * geschlossenem Raum (followRoomBlocked).
   */
  async onPersonStart(id: number): Promise<void> {
    if (!this.opts.follow) return;
    await this.ready;
    const cam = await this.d.camera(id);
    if (!cam) return;
    const room = this.room(id);
    const why = followBlocked(this.state(id), this.d.now(), cam, room);
    if (why && why === followRoomBlocked(room)) {
      this.d.count("follow", "skip_open", { cam: cam.name, room: roomLabel(room.closed) });
    }
    if (why) return;
    await this.serial(id, () => this.startFollow(cam, true));
  }

  /** PERSON entprellt beendet: Folgen beenden, zurueck in die Grundstellung. */
  async onPersonEnd(id: number): Promise<void> {
    if (!this.states.get(id)?.following) return;
    await this.serial(id, () => this.endFollow(id, "gone"));
  }

  /** Fahrzeug erkannt: eine laufende Nahaufnahme an einer Zonen-Kamera bricht ab. */
  onVehicleStart(id: number): void {
    const st = this.states.get(id);
    if (st?.closeUp && st.abort == null) st.abort = "vehicle";
  }

  /**
   * Handsteuerung: Automatik sofort beenden (ohne Rueckfahrt), 5 min Ruhe.
   * Fertig, sobald die Automatik die Kamera abgegeben hat (Tracking des Hubs
   * aus); erst dann geht der Befehl von Hand an die Kamera.
   */
  noteHand(id: number): Promise<void> {
    return this.takeOver(id, "hand", HAND_HOLD_MS).then(() => undefined);
  }

  /**
   * Regel „Kamera steuern“ uebernimmt. Vorher muss das Tracking des Hubs aus
   * sein, sonst merkt sich die Regel „an“ als Zustand vorher und stellt es
   * danach dauerhaft wieder her. true: Es liess sich nicht ausschalten; ein
   * „an“ stammt dann vom Hub, als Zustand vorher gilt „aus“. Liest die Regel
   * den Zustand, gehoert das Tracking ihr (ruleOwnsTracking). Waehrend des
   * Zurueckstellens nach einem Neustart wartet die Regel dieses ab.
   */
  noteRule(id: number, ms: number): Promise<boolean> {
    if (this.restoring) return this.ready.catch(() => undefined).then(() => this.takeOver(id, "rule", ms));
    return this.takeOver(id, "rule", ms);
  }

  /**
   * Die Regel hat den Zustand des Trackings gelesen und bestimmt ihn ab jetzt
   * selbst: Ein Tracking, das der Hub nicht ausschalten konnte, gehoert ihr,
   * der Hub vergisst sein Folgen. Liest sie nicht, versucht der Hub es nach
   * ihrer Sperre weiter.
   */
  ruleOwnsTracking(id: number): Promise<void> {
    const st = this.states.get(id);
    if (!st?.following || !this.trackOff.has(id)) return Promise.resolve();
    st.following = false;
    st.followCooldownUntil = this.d.now() + FOLLOW_COOLDOWN_MS;
    this.trackKeys.delete(id);
    this.trackOff.delete(id);
    this.d.log(`Kamera ${id}: Tracking des Hubs ließ sich nicht ausschalten – die Regel übernimmt es`);
    this.d.count("follow", "handed_rule", { cam: id });
    return this.persist();
  }

  private takeOver(id: number, by: "hand" | "rule", ms: number): Promise<boolean> {
    const st = this.state(id);
    const now = this.d.now();
    const until = now + ms;
    st.hold = { by, until };
    st.lastMovedAt = now;
    if (st.closeUp) st.abort = "hand";
    // Eine offene Rueckfahrt des Zooms wartet die Sperre ab und faehrt danach
    // nur, wenn niemand den Zoom verstellt hat (returnZoom).
    const away = this.zoomHomes.get(id);
    if (away) {
      away.hand = true;
      away.nextAt = until;
    }
    // Die Wartezeit der Rueckfahrt gleich in die Datei fuer den Neustart
    // (persist laeuft fuer sich nacheinander und wird nie abgelehnt).
    const saved: Promise<void> = away ? this.persist() : Promise.resolve();
    // Immer hinter die laufenden Ablaeufe dieser Kamera einreihen, auch wenn
    // sie (noch) nicht folgt: Ein Folgen, das gerade startet, ist dann sicher
    // wieder aus.
    const handed = this.serial(id, () => this.endFollow(id, by)).catch((e) =>
      this.fail(by === "hand" ? "Handsteuerung" : "Regel", e)
    );
    // Warten muss der Aufrufer nur, solange das Tracking des Hubs an ist oder
    // gerade eingeschaltet wird. Sonst gilt schon die Sperre: startFollow
    // prueft sie unmittelbar vor dem Einschalten, eine laufende Nahaufnahme
    // sieht den Abbruch sofort.
    if (st.following || this.engaging.has(id)) {
      return Promise.all([handed, saved]).then(() => by === "rule" && this.trackPending(id));
    }
    return saved.then(() => false);
  }

  /** Tracking des Hubs liess sich nicht ausschalten, ein Versuch steht aus. */
  private trackPending(id: number): boolean {
    return this.states.get(id)?.following === true && this.trackOff.has(id);
  }

  /**
   * Bei jedem Kamera-Poll: Folgen nach FOLLOW_MAX_MS beenden und offene
   * Rueckfahrten des Zooms nachholen.
   */
  async tick(): Promise<void> {
    const now = this.d.now();
    const due: number[] = [];
    for (const [id, st] of this.states) {
      if (st.following && now >= st.followUntil) {
        st.followUntil = Number.POSITIVE_INFINITY;
        due.push(id);
      }
    }
    const jobs = due.map((id) => this.serial(id, () => this.endFollow(id, "max")).catch((e) => this.fail("Folgen beenden", e)));
    for (const [id, away] of this.zoomHomes) {
      // Waehrend der Nahaufnahme entscheidet ihr Ende ueber die Rueckfahrt.
      if (now < away.nextAt || this.states.get(id)?.closeUp) continue;
      // Termin gleich weitersetzen: tick() kommt alle paar Sekunden wieder,
      // auch waehrend dieser Versuch noch auf die Kamera wartet.
      away.nextAt = now + ZOOM_RETURN_RETRY_MS;
      jobs.push(
        this.serial(id, async () => {
          await this.returnZoom(id);
          await this.persist();
        }).catch((e) => this.fail("Zoom zurück", e))
      );
    }
    await Promise.all(jobs);
  }

  /**
   * Optische Nahaufnahme der Personen; null = geht nicht oder lohnt nicht
   * (dann digital). Mit `face` fragt die Gesichtserkennung: Der Zoom faehrt
   * dann nur, wenn das Gesicht danach voraussichtlich gross genug ist
   * (opticalWorth). Ohne `face` fragt der Waechter (Mindestfaktor MIN_GAIN).
   * Eine laufende oder gerade fertige Nahaufnahme teilen sich beide; hat nur
   * die Gesichtserkennung verzichtet, plant der Waechter selbst.
   */
  async closeUp(id: number, face?: FaceNeed): Promise<CloseUp | null> {
    if (!this.opts.zoom) return null;
    await this.ready;
    const forFace = face != null;
    const running = this.closeUps.get(id)?.run;
    if (running) {
      const o = await running;
      if (o.result || !o.faceSkip || forFace) return o.result;
    }
    const now = this.d.now();
    const cached = this.closeUps.get(id);
    // Inzwischen hat eine andere Anfrage begonnen: deren Ergebnis gilt.
    if (cached?.run) return (await cached.run).result;
    if (cached?.outcome) {
      const entry = { ok: cached.outcome.result != null, faceSkip: cached.outcome.faceSkip, ageMs: now - cached.at };
      if (closeUpCacheUsable(entry, forFace)) return cached.outcome.result;
    }
    const cam = await this.d.camera(id);
    if (!cam || closeUpBlocked(this.state(id), now, cam, this.d.vehicleActive(id), this.zoomHomes.has(id), forFace)) return null;
    const run = this.serial(id, () => this.runCloseUp(cam, face)).catch((e): CloseUpOutcome => {
      this.fail(`${cam.name}: Nahaufnahme`, e);
      return NO_CLOSEUP;
    });
    this.closeUps.set(id, { at: now, outcome: null, run });
    const outcome = await run;
    this.closeUps.set(id, { at: this.d.now(), outcome, run: null });
    return outcome.result;
  }

  /**
   * Hub-Start: Bewegungen zurueckstellen, die ein Neustart unterbrochen hat.
   * Eine Zoom-Stellung, die sich jetzt nicht zurueckfahren laesst, bleibt
   * gemerkt; tick() versucht es weiter.
   */
  restore(): Promise<void> {
    this.restoring = true;
    this.ready = (async () => {
      const moves = await this.d.load().catch(() => [] as PersistedMove[]);
      for (const m of moves) {
        try {
          const id = m.cameraId;
          const zoomHome = typeof m.zoomHome === "number" ? m.zoomHome : null;
          const handUntil = typeof m.zoomHandUntil === "number" ? m.zoomHandUntil : null;
          if (zoomHome != null) {
            const now = this.d.now();
            this.zoomHomes.set(id, {
              name: typeof m.name === "string" && m.name ? m.name : String(id),
              home: zoomHome,
              autos: Array.isArray(m.zoomAuto) ? m.zoomAuto.filter((p) => typeof p === "number") : [],
              hand: handUntil != null,
              fails: 0,
              // Die Wartezeit nach Hand oder Regel laeuft ueber den Neustart
              // weiter, hoechstens so lange wie eine Handsteuerung sperrt
              // (falls die Uhr gestellt wurde).
              nextAt: handUntil != null ? Math.min(Math.max(handUntil, now), now + HAND_HOLD_MS) : now + ZOOM_RETURN_RETRY_MS,
            });
          }
          let trackOn = false;
          if (m.trackKey && !(await this.trackingOff(id, m.trackKey))) {
            // Noch an: wie ein laufendes Folgen merken, tick() schaltet es
            // nach TRACK_OFF_RETRY_MS erneut aus und faehrt dann zurueck.
            const st = this.state(id);
            const nextAt = this.d.now() + TRACK_OFF_RETRY_MS;
            st.following = true;
            st.followUntil = nextAt;
            this.trackKeys.set(id, m.trackKey);
            this.trackOff.set(id, { fails: 1, nextAt });
            this.d.count("follow", "off_retry", { cam: id, fails: 1 });
            trackOn = true;
            // Grundstellung schon jetzt kennen (liest nur), damit endFollow
            // nach dem Ausschalten dorthin zurueckfaehrt.
            const cam = await this.d.camera(id);
            if (cam) await this.ensureHome(cam);
          }
          if (zoomHome != null && handUntil == null) await this.serial(id, () => this.returnZoom(id));
          if (m.following && !trackOn) {
            const cam = await this.d.camera(id);
            // Hat Hand oder Regel inzwischen uebernommen, nicht ueber deren Befehl fahren.
            if (cam && (await this.ensureHome(cam)) && !activeHold(this.state(id), this.d.now())) await this.goHome(id);
          }
          this.d.log(
            `Kamera ${id}: nach Neustart ` +
              (trackOn
                ? `Tracking noch an, nächster Versuch in ${TRACK_OFF_RETRY_MS / 1000} s`
                : this.zoomHomes.has(id)
                  ? "zurückgestellt, die Rückfahrt des Zooms steht noch aus"
                  : "zurückgestellt")
          );
        } catch (e) {
          this.fail(`Kamera ${m?.cameraId} zurückstellen`, e);
        }
      }
      if (moves.length) await this.persist();
    })().finally(() => {
      this.restoring = false;
    });
    return this.ready;
  }

  private state(id: number): MotionState {
    let st = this.states.get(id);
    if (!st) {
      st = newMotionState(this.startedAt);
      this.states.set(id, st);
    }
    return st;
  }

  /** Ablaeufe je Kamera nacheinander (Folgen, Nahaufnahme, Rueckkehr). */
  private serial<T>(id: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.queues.set(id, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id);
      });
    return next;
  }

  /** Betriebszustand vom Treiber; scheitert die Abfrage, gilt er als unbekannt. */
  private room(id: number): FollowRoom {
    try {
      return this.d.followRoom(id);
    } catch {
      return { closed: null, hour: Number.NaN, nightWindow: "", always: false };
    }
  }

  private fail(what: string, e: unknown): void {
    this.d.log(`Kamera-Bewegung: ${what}: ${e instanceof Error ? e.message : e}`);
  }

  /**
   * Tracking der Kamera einschalten. `checkRoom`: Der Betriebszustand zaehlt
   * (Personen-Signal, Nahaufnahme der Gesichtserkennung); die Nahaufnahme des
   * Waechters zentriert unabhaengig davon.
   */
  private async startFollow(cam: MotionCam, checkRoom: boolean): Promise<boolean> {
    const st = this.state(cam.id);
    const now = this.d.now();
    const room = this.room(cam.id);
    const gate = checkRoom ? room : undefined;
    if (followBlocked(st, now, cam, gate)) return false;
    if (!(await this.ensureHome(cam))) return false;
    let cfg: Record<string, unknown>;
    try {
      cfg = await this.d.readTracking(cam.id);
    } catch (e) {
      st.trackRetryAt = now + TRACK_RETRY_MS;
      this.d.count("follow", "track_fail", { cam: cam.name });
      this.fail(`${cam.name}: Tracking lesen`, e);
      return false;
    }
    const info = readTrackingCfg(cfg);
    if (!info || info.on) {
      // Ohne Tracking kann die Kamera nicht folgen; dauerhaft an heisst, sie folgt selbst.
      st.trackRetryAt = now + TRACK_RECHECK_MS;
      this.d.log(`Kamera ${cam.name}: ${info ? "Tracking dauerhaft an – Hub greift nicht ein" : "kein Tracking in GetAiCfg – folgt nicht"}`);
      this.d.count("follow", info ? "camera_tracks" : "no_tracking", { cam: cam.name });
      return false;
    }
    const patch: Record<string, unknown> = { [info.key]: 1 };
    if (info.peopleOff) patch.trackType = { ...(cfg.trackType as Record<string, unknown>), people: 1 };
    // Hand oder Regel kann uebernommen haben, waehrend Grundstellung und
    // Tracking gelesen wurden: dann nicht mehr einschalten.
    if (followBlocked(st, this.d.now(), cam, gate)) {
      this.d.count("follow", "start_blocked", { cam: cam.name });
      return false;
    }
    // Ab hier kann das Tracking an sein, bevor st.following steht: Eine
    // Uebernahme durch Hand oder Regel wartet dann diesen Start ab (takeOver).
    this.engaging.add(cam.id);
    try {
      await this.d.writeTracking(cam.id, patch);
    } catch (e) {
      // Bleibt nur die Antwort aus, kann das Tracking trotzdem an sein. Dann
      // gehoert es dem Hub wie nach einem bestaetigten Start, und endFollow
      // schaltet es wieder aus; nur ein sicheres „aus“ gilt als gescheitert.
      const back = await this.d
        .readTracking(cam.id)
        .then((c) => readTrackingCfg(c))
        .catch(() => null);
      if (back && !back.on) {
        st.trackRetryAt = now + TRACK_RETRY_MS;
        this.d.count("follow", "track_fail", { cam: cam.name });
        this.fail(`${cam.name}: Tracking einschalten`, e);
        return false;
      }
      this.fail(`${cam.name}: Tracking einschalten ohne Bestätigung – gilt als an, wird wie ein Folgen beendet`, e);
      this.d.count("follow", "start_unconfirmed", { cam: cam.name, read: back ? "an" : "unbekannt" });
    } finally {
      this.engaging.delete(cam.id);
    }
    if (info.peopleOff) this.d.log(`Kamera ${cam.name}: Tracking für Personen eingeschaltet`);
    st.following = true;
    st.followUntil = now + FOLLOW_MAX_MS;
    st.lastMovedAt = now;
    this.trackKeys.set(cam.id, info.key);
    await this.persist();
    this.d.count("follow", "start", { cam: cam.name, room: roomLabel(room.closed) });
    this.d.log(`Kamera ${cam.name}: folgt der Person (höchstens ${FOLLOW_MAX_MS / 1000} s)`);
    return true;
  }

  private async endFollow(id: number, why: "gone" | "max" | "hand" | "rule"): Promise<void> {
    const st = this.state(id);
    if (!st.following) return;
    // Ausstehendes Ausschalten waehrend einer Regel: Die Regel bestimmt das
    // Tracking jetzt selbst; weiter erst nach ihrer Sperre, falls sie es
    // nicht uebernommen hat.
    if (why !== "rule" && this.trackOff.has(id) && activeHold(st, this.d.now()) === "rule") {
      st.followUntil = st.hold!.until;
      return;
    }
    const key = this.trackKeys.get(id);
    if (key && !(await this.trackingOff(id, key))) {
      // Tracking noch an oder unbekannt: nicht vergessen. Das Folgen gilt
      // weiter, tick() versucht es nach TRACK_OFF_RETRY_MS erneut, nach dem
      // letzten Versuch meldet der Hub die Kamera. Ein zusaetzlicher Versuch
      // vor dem Termin (Hand oder Regel) zaehlt nicht.
      const pend = this.trackOff.get(id);
      if (pend && this.d.now() < pend.nextAt) return;
      const fails = (pend?.fails ?? 0) + 1;
      if (fails <= TRACK_OFF_RETRIES) {
        const nextAt = this.d.now() + TRACK_OFF_RETRY_MS;
        this.trackOff.set(id, { fails, nextAt });
        st.followUntil = nextAt;
        this.d.count("follow", "off_retry", { cam: id, fails });
        await this.persist();
        return;
      }
      const name = (await this.d.camera(id).catch(() => null))?.name ?? String(id);
      this.d.log(`Kamera ${name}: Tracking des Hubs lässt sich nicht ausschalten – ${fails} Versuche ohne Erfolg`);
      this.d.warn(name, "Tracking lässt sich nicht ausschalten", `${fails} Versuche, das Tracking des Hubs auszuschalten, ohne Erfolg`);
      this.d.count("follow", "off_fail", { cam: id, fails });
    }
    this.trackOff.delete(id);
    this.trackKeys.delete(id);
    st.following = false;
    st.lastMovedAt = this.d.now();
    if (why === "hand" || why === "rule") {
      // Mensch oder Regel bewegt die Kamera jetzt: nicht zurueckfahren.
      this.d.count("follow", why === "hand" ? "end_hand" : "end_rule");
    } else if (activeHold(st, this.d.now())) {
      // Hand oder Regel hat uebernommen, waehrend das Tracking ausging: deren
      // Befehl steht schon an, die Grundstellung wuerde ihn ueberfahren.
      st.followCooldownUntil = this.d.now() + FOLLOW_COOLDOWN_MS;
      this.d.count("follow", "home_skip_hold", { cam: id, why });
    } else {
      const ok = await this.goHome(id);
      st.followCooldownUntil = this.d.now() + FOLLOW_COOLDOWN_MS;
      st.homeAt = this.d.now();
      this.d.count("follow", ok ? (why === "gone" ? "end_gone" : "end_max") : "home_fail", { cam: id });
    }
    await this.persist();
  }

  /**
   * Tracking des Hubs ausschalten. true, wenn die Kamera es bestaetigt oder
   * danach „aus“ meldet; false, wenn es noch an ist oder unbekannt bleibt.
   */
  private async trackingOff(id: number, key: string): Promise<boolean> {
    try {
      await this.d.writeTracking(id, { [key]: 0 });
      return true;
    } catch (e) {
      this.fail("Tracking ausschalten", e);
      const back = await this.d
        .readTracking(id)
        .then((c) => readTrackingCfg(c))
        .catch(() => null);
      return back != null && !back.on;
    }
  }

  private async goHome(id: number): Promise<boolean> {
    const home = this.homes.get(id)?.home;
    if (!home) return false;
    try {
      if (home.kind === "guard") await this.d.guard(id, "toPos");
      else await this.d.gotoPreset(id, home.id);
      return true;
    } catch (e) {
      this.fail("Grundstellung anfahren", e);
      return false;
    }
  }

  /**
   * Grundstellung: Wachposition der Kamera; fehlt sie, die aktuelle Stellung
   * speichern (nur nach 10 min ohne Bewegung); ohne Wachposition ein Preset
   * „Grundstellung“. Sonst folgt die Kamera nicht.
   */
  private async ensureHome(cam: MotionCam): Promise<Home | null> {
    const now = this.d.now();
    const known = this.homes.get(cam.id);
    if (known && (known.home || now - known.at < HOME_RETRY_MS)) return known.home;
    const guard = await this.d.readGuard(cam.id).catch(() => ({ supported: false, exists: false }));
    let home: Home | null = null;
    if (guard.supported && guard.exists) {
      home = { kind: "guard" };
    } else if (guard.supported) {
      if (now - this.state(cam.id).lastMovedAt < GUARD_IDLE_MS) return null;
      try {
        await this.d.guard(cam.id, "setPos");
        this.d.log(`Kamera ${cam.name}: aktuelle Stellung als Grundstellung (Wachposition) gespeichert`);
        home = { kind: "guard" };
      } catch (e) {
        this.fail(`${cam.name}: Wachposition speichern`, e);
      }
    }
    if (!home) {
      const presets = await this.d.presets(cam.id).catch(() => [] as Array<{ id: number; name: string }>);
      const p = presets.find((x) => x.name.trim().toLowerCase() === "grundstellung");
      if (p) home = { kind: "preset", id: p.id };
    }
    if (!home) {
      this.d.log(`Kamera ${cam.name}: keine Grundstellung (Wachposition oder Preset „Grundstellung“) – folgt nicht`);
      this.d.count("follow", "no_home", { cam: cam.name });
    }
    this.homes.set(cam.id, { home, at: now });
    return home;
  }

  private async runCloseUp(cam: MotionCam, face?: FaceNeed): Promise<CloseUpOutcome> {
    const st = this.state(cam.id);
    const t0 = this.d.now();
    if (closeUpBlocked(st, t0, cam, this.d.vehicleActive(cam.id), this.zoomHomes.has(cam.id), face != null)) return NO_CLOSEUP;
    st.closeUp = true;
    st.abort = null;
    const deadline = cam.zone ? t0 + CLOSEUP_ZONE_MAX_MS : Number.POSITIVE_INFINITY;
    const aborted = () => st.abort === "hand" || (st.abort === "vehicle" && cam.zone) || this.d.now() >= deadline;
    let moved = false;
    let faceSkip = false;
    try {
      // Schwenk-Kamera: erst die Person in die Mitte holen lassen (fuer die
      // Gesichtserkennung nur, wenn die Kamera nach dem Betriebszustand folgen darf).
      if (cam.pan && !st.following) await this.startFollow(cam, face != null);
      let boxes = await this.d.persons(await this.d.snap(cam.id));
      if (st.following) {
        const until = this.d.now() + CENTER_WAIT_MS;
        while (boxes?.length && !isCentered(largestBox(boxes)!) && this.d.now() < until && !aborted()) {
          await this.d.sleep(1_000);
          boxes = await this.d.persons(await this.d.snap(cam.id));
        }
      }
      if (!boxes?.length || aborted()) return NO_CLOSEUP;
      const zoom = await this.d.readZoom(cam.id);
      const factor = opticalFactor(cam.model);
      const plan = planCloseUp(boxes, zoom, factor);
      if (!plan) {
        this.d.count("camera", "closeup_skip", { cam: cam.name });
        return NO_CLOSEUP;
      }
      // Gesichtserkennung: nur fahren, wenn das Gesicht danach gross genug ist.
      if (face && !opticalWorth(face.size, plan.gain)) {
        faceSkip = true;
        this.d.count("camera", "closeup_skip_face", {
          cam: cam.name,
          size: face.size,
          upscaled: face.upscaled,
          gain: Number(plan.gain.toFixed(2)),
        });
        return { result: null, faceSkip: true };
      }
      const away: ZoomAway = {
        name: cam.name,
        home: zoom.pos,
        autos: [plan.pos],
        hand: false,
        fails: 0,
        nextAt: Number.POSITIVE_INFINITY,
      };
      this.zoomHomes.set(cam.id, away);
      await this.persist();
      // Hand oder Fahrzeug kann gekommen sein, waehrend der Zoom gelesen und
      // die Ausgangsstellung gespeichert wurde: dann nicht mehr losfahren.
      if (aborted()) {
        this.d.count("camera", "closeup_abort", { cam: cam.name });
        return NO_CLOSEUP;
      }
      st.lastMovedAt = this.d.now();
      // Schon vor dem Befehl als verstellt merken: Bleibt nur die Antwort der
      // Kamera aus, kann sie den Befehl trotzdem ausgefuehrt haben.
      moved = true;
      try {
        await this.d.writeZoom(cam.id, plan.pos);
      } finally {
        // Der Abstand zur naechsten Nahaufnahme zaehlt ab der Fahrt, auch
        // wenn die Antwort der Kamera ausbleibt; ein Versuch ohne Fahrt
        // setzt nur die kurze Pause (finally unten).
        st.lastCloseUpAt = this.d.now();
      }
      const shot = async (): Promise<{ jpeg: Buffer; boxes: NormBox[] } | null> => {
        await this.d.sleep(Math.max(0, Math.min(FOCUS_MS, deadline - this.d.now() - 1_000)));
        if (aborted()) return null;
        const jpeg = await this.d.snap(cam.id);
        const found = await this.d.persons(jpeg);
        return found?.length ? { jpeg, boxes: found } : null;
      };
      let gain = plan.gain;
      let got = await shot();
      const half = 1 + (plan.gain - 1) / 2;
      // Zweiter Versuch halb so weit; fuer die Gesichtserkennung nur, wenn er
      // dem Gesicht noch hilft.
      if (!got && !cam.zone && !aborted() && (!face || opticalWorth(face.size, half))) {
        gain = half;
        const pos = posForMagnification(plan.from * gain, zoom.min, zoom.max, factor);
        away.autos.push(pos);
        await this.d.writeZoom(cam.id, pos);
        got = await shot();
      }
      if (!got) {
        this.d.count("camera", aborted() ? "closeup_abort" : "closeup_lost", { cam: cam.name });
        return NO_CLOSEUP;
      }
      const before = largestBox(boxes)!;
      const after = largestBox(got.boxes)!;
      this.d.count("camera", "zoom_ratio", {
        cam: cam.name,
        model: cam.model,
        pos: plan.pos,
        expected: Number(gain.toFixed(2)),
        measured: Number((after.h / before.h).toFixed(2)),
      });
      return { result: { jpeg: got.jpeg, at: this.d.now(), gain, persons: got.boxes.length, boxes: got.boxes }, faceSkip: false };
    } finally {
      if (!moved) {
        // Kein Zoom-Befehl: nur die kurze Pause bis zur naechsten Planung, auch
        // an Zonen-Kameras. Ein Verzicht wegen des Gesichts haelt den Waechter
        // nicht auf.
        const until = this.d.now() + CLOSEUP_SKIP_PAUSE_MS;
        if (faceSkip) st.faceSkipUntil = until;
        else st.skipUntil = until;
      }
      const away = this.zoomHomes.get(cam.id);
      if (away && !moved) {
        this.zoomHomes.delete(cam.id);
      } else if (away && st.abort === "hand") {
        // Mensch oder Regel bewegt die Kamera jetzt: stehen lassen. Die
        // Ausgangsstellung bleibt gemerkt; nach der Sperre faehrt tick()
        // zurueck, wenn der Zoom dann noch steht, wo die Automatik ihn
        // hingestellt hat.
        away.hand = true;
        away.nextAt = st.hold?.until ?? this.d.now();
      } else if (away) {
        await this.returnZoom(cam.id);
      }
      st.closeUp = false;
      st.abort = null;
      // Fokus abwarten nur nach einer Fahrt; ohne Zoom-Befehl hat sich das
      // Objektiv nicht bewegt, Zonen-Auswertungen duerfen gleich wieder.
      if (moved) st.homeAt = this.d.now();
      await this.persist();
    }
  }

  /**
   * Zoom in die Ausgangsstellung zurueckfahren. Erledigt ist sie, wenn die
   * Kamera den Befehl angenommen hat oder der Zoom danach in der
   * Ausgangsstellung steht; bis dahin bleibt sie gemerkt (auch in der Datei
   * fuer den Neustart), und tick() versucht es im Abstand von
   * ZOOM_RETURN_RETRY_MS weiter. Nach dem letzten Versuch meldet der Hub die
   * Kamera, statt still aufzugeben.
   */
  private async returnZoom(id: number): Promise<void> {
    const away = this.zoomHomes.get(id);
    if (!away || this.waitForHold(id, away)) return;
    const st = this.state(id);
    const handed = away.hand;
    let unconfirmed = false;
    try {
      if (away.hand) {
        const cur = (await this.d.readZoom(id)).pos;
        // Wieder ein Befehl von Hand, waehrend der Zoom gelesen wurde.
        if (this.waitForHold(id, away)) return;
        if (!away.autos.some((pos) => shouldRestoreZoom(cur, pos, away.home))) {
          this.zoomHomes.delete(id);
          if (cur !== away.home) {
            this.d.log(`Kamera ${away.name}: Zoom inzwischen verstellt (Position ${cur}) – bleibt so`);
            this.d.count("camera", "zoom_restore_skip", { cam: away.name, pos: cur, home: away.home });
          }
          return;
        }
        // Der Zoom steht noch, wo die Automatik ihn hingestellt hat: Die
        // Rueckfahrt gehoert wieder ihr, auch wenn dieser Versuch scheitert.
        away.hand = false;
      }
      // Solange der Befehl unterwegs ist, faehrt das Objektiv: settled() ist
      // false, ein Kennzeichen-Burst wartet (hoechstens 3 s).
      this.zoomMoving.add(id);
      try {
        await this.d.writeZoom(id, away.home);
      } catch (e) {
        // Bleibt nur die Antwort der Kamera aus, kann sie trotzdem gefahren
        // sein: Steht der Zoom in der Ausgangsstellung, ist die Rueckfahrt
        // erledigt, und kein Versuch steht mehr aus.
        if ((await this.d.readZoom(id).catch(() => null))?.pos !== away.home) throw e;
        unconfirmed = true;
      } finally {
        this.zoomMoving.delete(id);
      }
    } catch (e) {
      away.fails++;
      if (zoomReturnGivenUp(away.fails)) {
        this.zoomHomes.delete(id);
        const msg = e instanceof Error ? e.message : String(e);
        this.d.log(`Kamera ${away.name}: Zoom steht nicht in Grundstellung – ${away.fails} Versuche, auf Position ${away.home} zurückzufahren, ohne Erfolg (${msg})`);
        this.d.warn(away.name, "Zoom steht nicht in Grundstellung", `Rückfahrt auf Position ${away.home} nach ${away.fails} Versuchen nicht gelungen: ${msg}`);
        this.d.count("camera", "zoom_restore_fail", { cam: away.name, home: away.home });
      } else {
        // Hat inzwischen Hand oder Regel uebernommen, wartet der naechste
        // Versuch deren Sperre ab.
        const held = this.waitForHold(id, away);
        if (!held) away.nextAt = this.d.now() + ZOOM_RETURN_RETRY_MS;
        this.fail(
          `${away.name}: Zoom zurück (Versuch ${away.fails}, nächster ${held ? "nach der Sperre" : `in ${ZOOM_RETURN_RETRY_MS / 1000} s`})`,
          e
        );
        this.d.count("camera", "zoom_restore_retry", { cam: away.name, fails: away.fails });
      }
      return;
    }
    this.zoomHomes.delete(id);
    // Das Objektiv faehrt jetzt erst: Zonen-Auswertungen warten den Fokus ab.
    st.homeAt = this.d.now();
    if (unconfirmed) {
      this.d.log(`Kamera ${away.name}: Zoom zurück ohne Bestätigung der Kamera – steht in der Ausgangsstellung`);
      this.d.count("camera", "zoom_restore_unconfirmed", { cam: away.name, fails: away.fails });
    }
    if (away.fails > 0 || handed) {
      this.d.log(
        `Kamera ${away.name}: Zoom wieder in der Ausgangsstellung (${handed ? "nach Handsteuerung oder Regel" : `nach ${away.fails} ${away.fails === 1 ? "Fehlversuch" : "Fehlversuchen"}`})`
      );
      this.d.count("camera", "zoom_restore_ok", { cam: away.name, fails: away.fails, hand: handed });
    }
  }

  /** Hand oder Regel steuert gerade: Die offene Rueckfahrt wartet die Sperre ab. */
  private waitForHold(id: number, away: ZoomAway): boolean {
    const st = this.state(id);
    if (!st.hold || !activeHold(st, this.d.now())) return false;
    away.hand = true;
    away.nextAt = st.hold.until;
    return true;
  }

  /** Stand in die Datei fuer den Neustart; nacheinander, weil mehrere Kameras zugleich fertig werden koennen. */
  private persist(): Promise<void> {
    this.saving = this.saving
      .then(() => this.d.save(this.moves()))
      .catch((e) => this.fail("Zustand speichern", e));
    return this.saving;
  }

  private moves(): PersistedMove[] {
    const moves: PersistedMove[] = [];
    for (const id of new Set([...this.states.keys(), ...this.zoomHomes.keys()])) {
      const following = this.states.get(id)?.following ?? false;
      const away = this.zoomHomes.get(id);
      if (!following && !away) continue;
      const move: PersistedMove = { cameraId: id, following, trackKey: this.trackKeys.get(id) ?? null, zoomHome: away?.home ?? null };
      if (away) {
        move.zoomAuto = away.autos;
        move.zoomHandUntil = away.hand ? (Number.isFinite(away.nextAt) ? away.nextAt : 0) : null;
        move.name = away.name;
      }
      moves.push(move);
    }
    return moves;
  }
}
