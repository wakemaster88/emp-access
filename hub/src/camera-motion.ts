/**
 * Kamera-Bewegungen fuer Personen: Schwenk-Kameras folgen (Tracking der
 * Kamera), Kameras mit Zoom-Objektiv machen eine gezielte optische
 * Nahaufnahme. Haelt je Kamera fest, wer sie bewegt (Hand > Regel >
 * Automatik), und bringt sie immer in die Grundstellung zurueck.
 * Kamerabefehle kommen ueber den Treiber (Reolink in cameras.ts).
 */
import type { NormBox } from "./person-crop-rules.js";
import {
  CENTER_WAIT_MS,
  CLOSEUP_CACHE_MS,
  CLOSEUP_ZONE_MAX_MS,
  FOCUS_MS,
  FOLLOW_COOLDOWN_MS,
  FOLLOW_MAX_MS,
  GUARD_IDLE_MS,
  HAND_HOLD_MS,
  HOME_RETRY_MS,
  TRACK_RECHECK_MS,
  TRACK_RETRY_MS,
  closeUpBlocked,
  followBlocked,
  isAtHome,
  isCentered,
  largestBox,
  newMotionState,
  opticalFactor,
  planCloseUp,
  posForMagnification,
  readTrackingCfg,
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
}

export interface CloseUp {
  jpeg: Buffer;
  at: number;
  /** Vergroesserung gegenueber dem Bild vorher. */
  gain: number;
  persons: number;
}

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
  save(moves: PersistedMove[]): Promise<void>;
  load(): Promise<PersistedMove[]>;
  log(msg: string): void;
  count(kind: "follow" | "camera", event: string, data?: Record<string, unknown>): void;
}

type Home = { kind: "guard" } | { kind: "preset"; id: number };

export class CameraMotion {
  private readonly states = new Map<number, MotionState>();
  private readonly homes = new Map<number, { home: Home | null; at: number }>();
  private readonly trackKeys = new Map<number, string>();
  private readonly zoomHomes = new Map<number, number>();
  private readonly closeUps = new Map<number, { at: number; result: CloseUp | null; run: Promise<CloseUp | null> | null }>();
  private readonly queues = new Map<number, Promise<unknown>>();
  private readonly startedAt: number;
  private ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly d: MotionDriver,
    private readonly opts: { follow: boolean; zoom: boolean }
  ) {
    this.startedAt = d.now();
  }

  isFollowing(id: number): boolean {
    return this.states.get(id)?.following ?? false;
  }

  /** Kamera in Grundstellung (Zonen-Auswertungen duerfen Bilder nehmen). */
  atHome(id: number): boolean {
    const st = this.states.get(id);
    return !st || isAtHome(st, this.d.now());
  }

  async waitAtHome(id: number, maxMs: number): Promise<boolean> {
    const until = this.d.now() + maxMs;
    while (!this.atHome(id)) {
      if (this.d.now() >= until) return false;
      await this.d.sleep(500);
    }
    return true;
  }

  /** Steigende PERSON-Flanke: Schwenk-Kamera folgen lassen. */
  async onPersonStart(id: number): Promise<void> {
    if (!this.opts.follow) return;
    await this.ready;
    const cam = await this.d.camera(id);
    if (!cam || followBlocked(this.state(id), this.d.now(), cam)) return;
    await this.serial(id, () => this.startFollow(cam));
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

  /** Handsteuerung: Automatik sofort beenden (ohne Rueckfahrt), 5 min Ruhe. */
  noteHand(id: number): Promise<void> {
    return this.takeOver(id, "hand", HAND_HOLD_MS);
  }

  /**
   * Regel „Kamera steuern“ uebernimmt. Vorher muss das Tracking des Hubs aus
   * sein, sonst merkt sich die Regel „an“ als Zustand vorher und stellt es
   * danach dauerhaft wieder her.
   */
  noteRule(id: number, ms: number): Promise<void> {
    return this.takeOver(id, "rule", ms);
  }

  private takeOver(id: number, by: "hand" | "rule", ms: number): Promise<void> {
    const st = this.state(id);
    const now = this.d.now();
    st.hold = { by, until: now + ms };
    st.lastMovedAt = now;
    if (st.closeUp) st.abort = "hand";
    if (!st.following) return Promise.resolve();
    return this.serial(id, () => this.endFollow(id, by)).catch((e) => this.fail(by === "hand" ? "Handsteuerung" : "Regel", e));
  }

  /** Bei jedem Kamera-Poll: Folgen nach FOLLOW_MAX_MS beenden. */
  async tick(): Promise<void> {
    const now = this.d.now();
    const due: number[] = [];
    for (const [id, st] of this.states) {
      if (st.following && now >= st.followUntil) {
        st.followUntil = Number.POSITIVE_INFINITY;
        due.push(id);
      }
    }
    await Promise.all(due.map((id) => this.serial(id, () => this.endFollow(id, "max")).catch((e) => this.fail("Folgen beenden", e))));
  }

  /** Optische Nahaufnahme der Personen; null = geht nicht oder lohnt nicht (dann digital). */
  async closeUp(id: number): Promise<CloseUp | null> {
    if (!this.opts.zoom) return null;
    await this.ready;
    const now = this.d.now();
    const cached = this.closeUps.get(id);
    if (cached?.run) return cached.run;
    if (cached && now - cached.at < CLOSEUP_CACHE_MS) return cached.result;
    const cam = await this.d.camera(id);
    if (!cam || closeUpBlocked(this.state(id), now, cam, this.d.vehicleActive(id))) return null;
    const run = this.serial(id, () => this.runCloseUp(cam)).catch((e) => {
      this.fail(`${cam.name}: Nahaufnahme`, e);
      return null;
    });
    this.closeUps.set(id, { at: now, result: null, run });
    const result = await run;
    this.closeUps.set(id, { at: this.d.now(), result, run: null });
    return result;
  }

  /** Hub-Start: Bewegungen zurueckstellen, die ein Neustart unterbrochen hat. */
  restore(): Promise<void> {
    this.ready = (async () => {
      const moves = await this.d.load().catch(() => [] as PersistedMove[]);
      for (const m of moves) {
        try {
          if (m.trackKey) await this.d.writeTracking(m.cameraId, { [m.trackKey]: 0 });
          if (m.zoomHome != null) await this.d.writeZoom(m.cameraId, m.zoomHome);
          if (m.following) {
            const cam = await this.d.camera(m.cameraId);
            if (cam && (await this.ensureHome(cam))) await this.goHome(m.cameraId);
          }
          this.d.log(`Kamera ${m.cameraId}: nach Neustart zurückgestellt`);
        } catch (e) {
          this.fail(`Kamera ${m.cameraId} zurückstellen`, e);
        }
      }
      if (moves.length) await this.d.save([]).catch(() => undefined);
    })();
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

  private fail(what: string, e: unknown): void {
    this.d.log(`Kamera-Bewegung: ${what}: ${e instanceof Error ? e.message : e}`);
  }

  private async startFollow(cam: MotionCam): Promise<boolean> {
    const st = this.state(cam.id);
    const now = this.d.now();
    if (followBlocked(st, now, cam)) return false;
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
    try {
      await this.d.writeTracking(cam.id, patch);
    } catch (e) {
      st.trackRetryAt = now + TRACK_RETRY_MS;
      this.d.count("follow", "track_fail", { cam: cam.name });
      this.fail(`${cam.name}: Tracking einschalten`, e);
      return false;
    }
    if (info.peopleOff) this.d.log(`Kamera ${cam.name}: Tracking für Personen eingeschaltet`);
    st.following = true;
    st.followUntil = now + FOLLOW_MAX_MS;
    st.lastMovedAt = now;
    this.trackKeys.set(cam.id, info.key);
    await this.persist();
    this.d.count("follow", "start", { cam: cam.name });
    this.d.log(`Kamera ${cam.name}: folgt der Person (höchstens ${FOLLOW_MAX_MS / 1000} s)`);
    return true;
  }

  private async endFollow(id: number, why: "gone" | "max" | "hand" | "rule"): Promise<void> {
    const st = this.state(id);
    if (!st.following) return;
    const key = this.trackKeys.get(id);
    if (key) await this.d.writeTracking(id, { [key]: 0 }).catch((e) => this.fail("Tracking ausschalten", e));
    this.trackKeys.delete(id);
    st.following = false;
    st.lastMovedAt = this.d.now();
    if (why === "hand" || why === "rule") {
      // Mensch oder Regel bewegt die Kamera jetzt: nicht zurueckfahren.
      this.d.count("follow", why === "hand" ? "end_hand" : "end_rule");
    } else {
      const ok = await this.goHome(id);
      st.followCooldownUntil = this.d.now() + FOLLOW_COOLDOWN_MS;
      st.homeAt = this.d.now();
      this.d.count("follow", ok ? (why === "gone" ? "end_gone" : "end_max") : "home_fail", { cam: id });
    }
    await this.persist();
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

  private async runCloseUp(cam: MotionCam): Promise<CloseUp | null> {
    const st = this.state(cam.id);
    const t0 = this.d.now();
    if (closeUpBlocked(st, t0, cam, this.d.vehicleActive(cam.id))) return null;
    st.closeUp = true;
    st.abort = null;
    st.lastCloseUpAt = t0;
    const deadline = cam.zone ? t0 + CLOSEUP_ZONE_MAX_MS : Number.POSITIVE_INFINITY;
    const aborted = () => st.abort === "hand" || (st.abort === "vehicle" && cam.zone) || this.d.now() >= deadline;
    let moved = false;
    try {
      // Schwenk-Kamera: erst die Person in die Mitte holen lassen.
      if (cam.pan && !st.following) await this.startFollow(cam);
      let boxes = await this.d.persons(await this.d.snap(cam.id));
      if (st.following) {
        const until = this.d.now() + CENTER_WAIT_MS;
        while (boxes?.length && !isCentered(largestBox(boxes)!) && this.d.now() < until && !aborted()) {
          await this.d.sleep(1_000);
          boxes = await this.d.persons(await this.d.snap(cam.id));
        }
      }
      if (!boxes?.length || aborted()) return null;
      const zoom = await this.d.readZoom(cam.id);
      const factor = opticalFactor(cam.model);
      const plan = planCloseUp(boxes, zoom, factor);
      if (!plan) {
        this.d.count("camera", "closeup_skip", { cam: cam.name });
        return null;
      }
      this.zoomHomes.set(cam.id, zoom.pos);
      await this.persist();
      st.lastMovedAt = this.d.now();
      await this.d.writeZoom(cam.id, plan.pos);
      moved = true;
      const shot = async (): Promise<{ jpeg: Buffer; boxes: NormBox[] } | null> => {
        await this.d.sleep(Math.max(0, Math.min(FOCUS_MS, deadline - this.d.now() - 1_000)));
        if (aborted()) return null;
        const jpeg = await this.d.snap(cam.id);
        const found = await this.d.persons(jpeg);
        return found?.length ? { jpeg, boxes: found } : null;
      };
      let gain = plan.gain;
      let got = await shot();
      if (!got && !cam.zone && !aborted()) {
        gain = 1 + (plan.gain - 1) / 2;
        await this.d.writeZoom(cam.id, posForMagnification(plan.from * gain, zoom.min, zoom.max, factor));
        got = await shot();
      }
      if (!got) {
        this.d.count("camera", aborted() ? "closeup_abort" : "closeup_lost", { cam: cam.name });
        return null;
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
      return { jpeg: got.jpeg, at: this.d.now(), gain, persons: got.boxes.length };
    } finally {
      const home = this.zoomHomes.get(cam.id);
      if (moved && home != null && st.abort !== "hand") {
        await this.d.writeZoom(cam.id, home).catch((e) => this.fail(`${cam.name}: Zoom zurück`, e));
      }
      this.zoomHomes.delete(cam.id);
      st.closeUp = false;
      st.abort = null;
      st.homeAt = this.d.now();
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const moves: PersistedMove[] = [];
    for (const [id, st] of this.states) {
      const zoomHome = this.zoomHomes.get(id) ?? null;
      if (st.following || zoomHome != null) {
        moves.push({ cameraId: id, following: st.following, trackKey: this.trackKeys.get(id) ?? null, zoomHome });
      }
    }
    await this.d.save(moves).catch((e) => this.fail("Zustand speichern", e));
  }
}
