import { test } from "node:test";
import assert from "node:assert/strict";
import { CameraMotion, type GuardInfo, type MotionCam, type MotionDriver, type PersistedMove } from "./camera-motion.js";
import { HAND_HOLD_MS, ZOOM_RETURN_RETRIES, ZOOM_RETURN_RETRY_MS, type FollowRoom, type ZoomRange } from "./camera-motion-rules.js";
import type { NormBox } from "./person-crop-rules.js";

const MID: NormBox = { x: 0.45, y: 0.375, w: 0.1, h: 0.25 };
const LEFT: NormBox = { x: 0.05, y: 0.4, w: 0.1, h: 0.2 };

const PTZ: MotionCam = { id: 5, name: "Übungslift", model: "RLC-823A 16X", pan: true, zoom: true, zone: false };
const PAN: MotionCam = { id: 7, name: "Shop", model: "E1 Pro", pan: true, zoom: false, zone: false };
const ZOOM: MotionCam = { id: 4, name: "Seilbahn B", model: "RLC-811A", pan: false, zoom: true, zone: false };
const ZONE: MotionCam = { id: 9, name: "Eingang", model: "RLC-811A", pan: false, zoom: true, zone: true };

class FakeDriver implements MotionDriver {
  t = 1_000_000;
  calls: string[] = [];
  counts: string[] = [];
  cams = new Map<number, MotionCam>();
  zoom = new Map<number, ZoomRange>();
  ai = new Map<number, Record<string, unknown>>();
  guards = new Map<number, GuardInfo>();
  presetList = new Map<number, Array<{ id: number; name: string }>>();
  boxes: Array<NormBox[] | null> = [];
  fallbackBoxes: NormBox[] | null = [MID];
  vehicles = new Set<number>();
  /** Betriebszustand: ab Werk geschlossen (Folgen erlaubt), wie nachts. */
  room: FollowRoom = { closed: true, hour: 12, nightWindow: "22-6", always: false };
  /** Zähler mit ihren Daten. */
  events: Array<{ key: string; data?: Record<string, unknown> }> = [];
  stored: PersistedMove[] = [];
  saved: PersistedMove[] = [];
  warnings: string[] = [];
  onSleep: (() => void) | null = null;
  onReadZoom: (() => void) | null = null;
  onReadTracking: (() => void) | null = null;
  onWriteTracking: (() => void) | null = null;
  /** Hält readTracking an, bis der Test es freigibt. */
  trackingGate: Promise<void> | null = null;
  /** Hält den nächsten writeTracking an, bis der Test es freigibt (einmal). */
  writeGate: Promise<void> | null = null;
  /** Hält das nächste Bild an, bis der Test es freigibt (einmal). */
  snapGate: Promise<void> | null = null;
  /**
   * Störung beim Zoom-Befehl: "lost" = die Kamera bekommt ihn nicht,
   * "late" = sie führt ihn aus, aber ihre Antwort bleibt aus.
   */
  zoomError: ((pos: number) => "lost" | "late" | null) | null = null;
  /** Störung beim Tracking-Befehl, wie bei zoomError; `on` = einschalten. */
  trackError: ((on: boolean) => "lost" | "late" | null) | null = null;
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.t += ms;
    this.onSleep?.();
  }
  async camera(id: number) {
    return this.cams.get(id) ?? null;
  }
  async readZoom(id: number) {
    const zoom = { ...this.zoom.get(id)! };
    this.onReadZoom?.();
    return zoom;
  }
  async writeZoom(id: number, pos: number) {
    this.calls.push(`zoom ${id} ${pos}`);
    const error = this.zoomError?.(pos) ?? null;
    if (error !== "lost") this.zoom.set(id, { ...this.zoom.get(id)!, pos });
    if (error) throw new Error("The operation was aborted due to timeout");
  }
  async readTracking(id: number) {
    const cfg = { ...(this.ai.get(id) ?? {}) };
    this.onReadTracking?.();
    if (this.trackingGate) await this.trackingGate;
    return cfg;
  }
  async writeTracking(id: number, patch: Record<string, unknown>) {
    const gate = this.writeGate;
    this.writeGate = null;
    if (gate) await gate;
    this.calls.push(`track ${id} ${JSON.stringify(patch)}`);
    const error = this.trackError?.(Object.values(patch).includes(1)) ?? null;
    if (error !== "lost") this.ai.set(id, { ...this.ai.get(id), ...patch });
    this.onWriteTracking?.();
    if (error) throw new Error("The operation was aborted due to timeout");
  }
  async readGuard(id: number) {
    return this.guards.get(id) ?? { supported: false, exists: false };
  }
  async guard(id: number, cmd: "toPos" | "setPos") {
    this.calls.push(`guard ${id} ${cmd}`);
  }
  async presets(id: number) {
    return this.presetList.get(id) ?? [];
  }
  async gotoPreset(id: number, presetId: number) {
    this.calls.push(`preset ${id} ${presetId}`);
  }
  async snap(id: number) {
    const gate = this.snapGate;
    this.snapGate = null;
    if (gate) await gate;
    return Buffer.from(`snap ${id} ${this.t}`);
  }
  async persons() {
    return this.boxes.length ? this.boxes.shift()! : this.fallbackBoxes;
  }
  vehicleActive(id: number) {
    return this.vehicles.has(id);
  }
  followRoom() {
    return this.room;
  }
  async save(moves: PersistedMove[]) {
    // Wie die Datei: nur, was JSON übersteht.
    this.saved = JSON.parse(JSON.stringify(moves)) as PersistedMove[];
  }
  async load() {
    return this.stored;
  }
  log() {}
  warn(where: string, title: string) {
    this.warnings.push(`${where}: ${title}`);
  }
  count(kind: string, event: string, data?: Record<string, unknown>) {
    this.counts.push(`${kind}.${event}`);
    this.events.push({ key: `${kind}.${event}`, data });
  }
}

function setup(...cams: MotionCam[]) {
  const d = new FakeDriver();
  for (const c of cams) {
    d.cams.set(c.id, c);
    d.zoom.set(c.id, { pos: 0, min: 0, max: 33 });
    d.ai.set(c.id, { bSmartTrack: 0, aiTrack: 0, trackType: { people: 1, vehicle: 0 } });
    d.guards.set(c.id, { supported: true, exists: true });
  }
  return { d, m: new CameraMotion(d, { follow: true, zoom: true }) };
}

test("Schwenk-Kamera folgt, bei „Person weg“ zurück in die Wachposition, dann 1 min Pause", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
  assert.equal(m.atHome(7), false);
  assert.deepEqual(d.calls, ['track 7 {"bSmartTrack":1}']);
  assert.equal(d.saved.length, 1);
  await m.onPersonEnd(7);
  assert.deepEqual(d.calls.slice(1), ['track 7 {"bSmartTrack":0}', "guard 7 toPos"]);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.counts, ["follow.start", "follow.end_gone"]);
  assert.equal(d.saved.length, 0);
  d.t += 30_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  d.t += 31_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
});

test("Folgen endet spätestens nach 120 s", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.t += 119_000;
  await m.tick();
  assert.equal(m.isFollowing(7), true);
  d.t += 1_000;
  await m.tick();
  assert.equal(m.isFollowing(7), false);
  assert.ok(d.counts.includes("follow.end_max"));
  assert.equal(d.calls.at(-1), "guard 7 toPos");
});

test("Hand bricht das Folgen ab, ohne zurückzufahren, und sperrt 5 min", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  await m.noteHand(7);
  assert.deepEqual(d.calls, ['track 7 {"bSmartTrack":1}', 'track 7 {"bSmartTrack":0}']);
  assert.deepEqual(d.counts, ["follow.start", "follow.end_hand"]);
  d.t += 4 * 60_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  d.t += 61_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
});

test("Regel übernimmt: erst Tracking des Hubs aus, dann hält die Automatik still", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  await m.noteRule(7, 30_000);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, ['track 7 {"bSmartTrack":1}', 'track 7 {"bSmartTrack":0}']);
  assert.deepEqual(d.counts, ["follow.start", "follow.end_rule"]);
  d.t += 10_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  d.t += 21_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
});

test("Tracking schon dauerhaft an: Hub greift nicht ein", async () => {
  const { d, m } = setup(PAN);
  d.ai.set(7, { bSmartTrack: 1 });
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, []);
  assert.deepEqual(d.counts, ["follow.camera_tracks"]);
});

test("Personen als Zielart aus: Hub schaltet sie mit ein, sonst nichts", async () => {
  const { d, m } = setup(PAN);
  d.ai.set(7, { aiTrack: 0, trackType: { people: 0, vehicle: 1 } });
  await m.onPersonStart(7);
  assert.deepEqual(d.calls, ['track 7 {"aiTrack":1,"trackType":{"people":1,"vehicle":1}}']);
});

test("Ohne Wachposition: Preset „Grundstellung“, sonst kein Folgen", async () => {
  const gastro: MotionCam = { ...PAN, id: 2, name: "Gastro" };
  const { d, m } = setup(PAN, gastro);
  d.guards.set(7, { supported: false, exists: false });
  d.presetList.set(7, [{ id: 3, name: "Grundstellung" }]);
  d.guards.set(2, { supported: false, exists: false });
  await m.onPersonStart(7);
  await m.onPersonEnd(7);
  assert.equal(d.calls.at(-1), "preset 7 3");
  await m.onPersonStart(2);
  assert.equal(m.isFollowing(2), false);
  assert.ok(d.counts.includes("follow.no_home"));
});

test("Wachposition fehlt: erst nach 10 min ohne Bewegung speichern", async () => {
  const { d, m } = setup(PAN);
  d.guards.set(7, { supported: true, exists: false });
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  d.t += 10 * 60_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
  assert.deepEqual(d.calls, ["guard 7 setPos", 'track 7 {"bSmartTrack":1}']);
});

test("Zonen-Kamera folgt nie", async () => {
  const { d, m } = setup({ ...PAN, id: 13, zone: true });
  await m.onPersonStart(13);
  assert.equal(m.isFollowing(13), false);
  assert.deepEqual(d.calls, []);
});

test("Zoom-Kamera: Nahaufnahme auf die Person in der Mitte, danach zurück; Ergebnis wird geteilt", async () => {
  const { d, m } = setup(ZOOM);
  const shot = await m.closeUp(4);
  assert.ok(shot);
  assert.ok(Math.abs(shot.gain - 2.4) < 1e-9);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  assert.equal(m.atHome(4), false);
  d.t += 3_000;
  assert.equal(m.atHome(4), true);
  assert.equal(await m.closeUp(4), shot);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  assert.ok(d.counts.includes("camera.zoom_ratio"));
});

test("Person am Rand: keine Nahaufnahme, der Zoom bleibt", async () => {
  const { d, m } = setup(ZOOM);
  d.fallbackBoxes = [{ x: 0.9, y: 0.4, w: 0.08, h: 0.2 }];
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, []);
  assert.ok(d.counts.includes("camera.closeup_skip"));
});

test("Person verloren: einmal halb so weit, dann aufgeben und zurück", async () => {
  const { d, m } = setup(ZOOM);
  d.boxes = [[MID], [], []];
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 6", "zoom 4 0"]);
  assert.ok(d.counts.includes("camera.closeup_lost"));
});

test("Zonen-Kamera: nicht bei Fahrzeug, kein zweiter Versuch, höchstens alle 2 min", async () => {
  const { d, m } = setup(ZONE);
  d.vehicles.add(9);
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, []);
  d.vehicles.clear();
  d.boxes = [[MID], []];
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, ["zoom 9 12", "zoom 9 0"]);
  d.t += 60_000;
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, ["zoom 9 12", "zoom 9 0"]);
});

test("Fahrzeug während der Nahaufnahme an der Zonen-Kamera: sofort zurück", async () => {
  const { d, m } = setup(ZONE);
  d.onSleep = () => m.onVehicleStart(9);
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, ["zoom 9 12", "zoom 9 0"]);
  assert.ok(d.counts.includes("camera.closeup_abort"));
});

test("Hand während der Nahaufnahme: der Zoom bleibt, wo er ist", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, ["zoom 4 12"]);
});

test("Schwenk-Kamera mit Zoom: erst zentrieren lassen, dann zoomen, Folgen läuft weiter", async () => {
  const { d, m } = setup(PTZ);
  d.boxes = [[LEFT], [MID], [MID]];
  const shot = await m.closeUp(5);
  assert.ok(shot);
  assert.equal(m.isFollowing(5), true);
  assert.deepEqual(d.calls, ['track 5 {"bSmartTrack":1}', "zoom 5 3", "zoom 5 0"]);
});

/** Laufende Mikrotasks abarbeiten lassen (Ablauf bis zum nächsten echten Warten). */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("Hand kommt, während das Tracking gelesen wird: Folgen wird nicht mehr eingeschaltet", async () => {
  const { d, m } = setup(PAN);
  d.onReadTracking = () => void m.noteHand(7);
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, []);
  assert.deepEqual(d.counts, ["follow.start_blocked"]);
  assert.equal(d.saved.length, 0);
});

test("Hand kommt, während das Tracking eingeschaltet wird: Folgen endet gleich wieder, ohne Rückfahrt", async () => {
  const { d, m } = setup(PAN);
  let hand: Promise<void> | null = null;
  d.onWriteTracking = () => {
    hand ??= m.noteHand(7);
  };
  await m.onPersonStart(7);
  await hand;
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, ['track 7 {"bSmartTrack":1}', 'track 7 {"bSmartTrack":0}']);
  assert.deepEqual(d.counts, ["follow.start", "follow.end_hand"]);
  assert.equal(d.saved.length, 0);
});

test("Regel kommt, während das Folgen startet: Tracking des Hubs ist aus, bevor die Regel weitermacht", async () => {
  const { d, m } = setup(PAN);
  let rule: Promise<boolean> | null = null;
  d.onWriteTracking = () => {
    rule ??= m.noteRule(7, 30_000);
  };
  await m.onPersonStart(7);
  await rule;
  assert.equal(d.ai.get(7)?.bSmartTrack, 0);
  assert.deepEqual(d.counts, ["follow.start", "follow.end_rule"]);
});

test("Handsteuerung, während das Folgen startet und die Kamera noch liest: sofort fertig, das Folgen bleibt aus", async () => {
  const { d, m } = setup(PAN);
  let release = () => {};
  d.trackingGate = new Promise<void>((resolve) => (release = resolve));
  const start = m.onPersonStart(7);
  await settle();
  let handed = false;
  void m.noteHand(7).then(() => (handed = true));
  await settle();
  // Das Tracking ist noch nicht an: Der Befehl von Hand muss nicht warten.
  assert.equal(handed, true);
  release();
  await start;
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, []);
  assert.deepEqual(d.counts, ["follow.start_blocked"]);
});

test("Handsteuerung, während das Tracking eingeschaltet wird: erst fertig, wenn es wieder aus ist", async () => {
  const { d, m } = setup(PAN);
  let release = () => {};
  d.writeGate = new Promise<void>((resolve) => (release = resolve));
  const start = m.onPersonStart(7);
  await settle();
  let handed = false;
  const hand = m.noteHand(7).then(() => (handed = true));
  await settle();
  // Der Befehl zum Einschalten ist unterwegs: Der Befehl von Hand geht noch nicht hinaus.
  assert.equal(handed, false);
  release();
  await hand;
  await start;
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, ['track 7 {"bSmartTrack":1}', 'track 7 {"bSmartTrack":0}']);
  assert.deepEqual(d.counts, ["follow.start", "follow.end_hand"]);
});

test("Regel an einer Kamera, die nicht folgt: sofort fertig, auch während eine Nahaufnahme auf ihr Bild wartet", async () => {
  const { d, m } = setup(ZOOM);
  let release = () => {};
  d.snapGate = new Promise<void>((resolve) => (release = resolve));
  const close = m.closeUp(4);
  await settle();
  let ruled = false;
  void m.noteRule(4, 30_000).then(() => (ruled = true));
  await settle();
  assert.equal(ruled, true);
  release();
  // Die Nahaufnahme sieht den Abbruch und faehrt nicht mehr los.
  assert.equal(await close, null);
  assert.deepEqual(d.calls, []);
});

test("Handsteuerung ohne laufende Automatik: sofort fertig, kein Kamerabefehl", async () => {
  const { d, m } = setup(PAN);
  await m.noteHand(7);
  assert.deepEqual(d.calls, []);
  assert.deepEqual(d.counts, []);
});

test("Rückfahrt des Zooms scheitert einmal: Ausgangsstellung bleibt gemerkt, 30 s später klappt es", async () => {
  const { d, m } = setup(ZOOM);
  let lose = true;
  d.zoomError = (pos) => {
    if (pos !== 0 || !lose) return null;
    lose = false;
    return "lost";
  };
  assert.ok(await m.closeUp(4));
  assert.equal(d.zoom.get(4)?.pos, 12);
  // Die Ausgangsstellung steht weiter in der Datei für den Neustart.
  assert.deepEqual(d.saved, [
    { cameraId: 4, following: false, trackKey: null, zoomHome: 0, zoomAuto: [12], zoomHandUntil: null, name: "Seilbahn B" },
  ]);
  d.t += ZOOM_RETURN_RETRY_MS - 1;
  await m.tick();
  assert.equal(d.zoom.get(4)?.pos, 12);
  d.t += 1;
  await m.tick();
  assert.equal(d.zoom.get(4)?.pos, 0);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0", "zoom 4 0"]);
  assert.deepEqual(d.saved, []);
  // Das Objektiv fährt jetzt erst zurück: Zonen-Auswertungen warten den Fokus ab.
  assert.equal(m.atHome(4), false);
  d.t += 3_000;
  assert.equal(m.atHome(4), true);
  assert.ok(d.counts.includes("camera.zoom_restore_retry"));
  assert.ok(d.counts.includes("camera.zoom_restore_ok"));
  assert.deepEqual(d.warnings, []);
  // Erledigt: kein weiterer Befehl.
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.equal(d.calls.length, 3);
});

test("Rückfahrt scheitert dauerhaft: zehn weitere Versuche im Abstand von 30 s, dann eine Meldung", async () => {
  const { d, m } = setup(ZOOM);
  d.zoomError = (pos) => (pos === 0 ? "lost" : null);
  assert.ok(await m.closeUp(4));
  for (let i = 1; i <= ZOOM_RETURN_RETRIES; i++) {
    assert.deepEqual(d.warnings, []);
    assert.equal(d.saved.length, 1);
    d.t += ZOOM_RETURN_RETRY_MS;
    await m.tick();
  }
  assert.deepEqual(d.warnings, ["Seilbahn B: Zoom steht nicht in Grundstellung"]);
  assert.equal(d.calls.filter((c) => c === "zoom 4 0").length, 1 + ZOOM_RETURN_RETRIES);
  assert.equal(d.counts.filter((c) => c === "camera.zoom_restore_retry").length, ZOOM_RETURN_RETRIES);
  assert.equal(d.counts.filter((c) => c === "camera.zoom_restore_fail").length, 1);
  assert.deepEqual(d.saved, []);
  // Danach ist Schluss: keine weiteren Befehle, keine zweite Meldung.
  d.t += 10 * ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.equal(d.calls.filter((c) => c === "zoom 4 0").length, 1 + ZOOM_RETURN_RETRIES);
  assert.equal(d.warnings.length, 1);
});

test("Solange die Rückfahrt aussteht, gilt die Kamera nicht als in Grundstellung", async () => {
  const { d, m } = setup(ZOOM);
  let lose = 2;
  d.zoomError = (pos) => (pos === 0 && lose-- > 0 ? "lost" : null);
  assert.ok(await m.closeUp(4));
  // Halteverbot und Parkfläche warten, auch lange nach dem Fokus.
  d.t += 10_000;
  assert.equal(m.atHome(4), false);
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.equal(m.atHome(4), false);
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.equal(d.zoom.get(4)?.pos, 0);
  // Zurück: noch der Fokus, dann wieder frei.
  assert.equal(m.atHome(4), false);
  d.t += 3_000;
  assert.equal(m.atHome(4), true);
});

test("Rückfahrt nach Handsteuerung scheitert: ab dann wartet die Grundstellung wieder auf die Automatik", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  d.onSleep = null;
  // Unter Handsteuerung gilt wie bisher, was die Kamera zeigt.
  d.t += 3_000;
  assert.equal(m.atHome(4), true);
  let lose = true;
  d.zoomError = (pos) => {
    if (pos !== 0 || !lose) return null;
    lose = false;
    return "lost";
  };
  d.t += HAND_HOLD_MS;
  await m.tick();
  assert.equal(d.zoom.get(4)?.pos, 12);
  assert.equal(m.atHome(4), false);
  // Der nächste Versuch fährt ohne erneutes Lesen zurück.
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.equal(d.zoom.get(4)?.pos, 0);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0", "zoom 4 0"]);
  assert.deepEqual(d.saved, []);
});

test("Solange die Rückfahrt aussteht, startet keine neue Nahaufnahme", async () => {
  const { d, m } = setup(ZOOM);
  let lose = 3;
  d.zoomError = (pos) => (pos === 0 && lose-- > 0 ? "lost" : null);
  assert.ok(await m.closeUp(4));
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  d.t += 20_000;
  // Abstand und Zwischenspeicher sind abgelaufen, der Zoom steht aber noch herein.
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0", "zoom 4 0"]);
  assert.equal(d.saved[0]?.zoomHome, 0);
  d.t += 10_000;
  await m.tick();
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.equal(d.zoom.get(4)?.pos, 0);
  // Zurück in der Ausgangsstellung: die nächste Nahaufnahme geht wieder von dort aus.
  d.t += 3_000;
  assert.ok(await m.closeUp(4));
  assert.deepEqual(d.calls.slice(-2), ["zoom 4 12", "zoom 4 0"]);
});

test("Rückfahrt ohne Antwort der Kamera, der Zoom steht aber zurück: erledigt, kein weiterer Versuch", async () => {
  const { d, m } = setup(ZOOM);
  d.zoomError = (pos) => (pos === 0 ? "late" : null);
  assert.ok(await m.closeUp(4));
  assert.equal(d.zoom.get(4)?.pos, 0);
  assert.deepEqual(d.saved, []);
  assert.ok(d.counts.includes("camera.zoom_restore_unconfirmed"));
  assert.equal(d.counts.includes("camera.zoom_restore_retry"), false);
  // Nur noch der Fokus, dann gilt die Kamera wieder als in Grundstellung.
  assert.equal(m.atHome(4), false);
  d.t += 3_000;
  assert.equal(m.atHome(4), true);
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
});

test("Rückfahrt steht aus: Halteverbot und Parkfläche warten, der Kennzeichen-Burst nicht", async () => {
  const { d, m } = setup(ZOOM);
  d.zoomError = (pos) => (pos === 0 ? "lost" : null);
  assert.ok(await m.closeUp(4));
  assert.equal(d.zoom.get(4)?.pos, 12);
  // Fokus nach der Nahaufnahme abwarten: Bis zum nächsten Versuch fährt nichts.
  assert.equal(m.settled(4), false);
  d.t += 3_000;
  assert.equal(m.atHome(4), false);
  assert.equal(m.settled(4), true);
  const t = d.t;
  assert.equal(await m.waitSettled(4, 3_000), true);
  assert.equal(d.t, t);
  // Während einer Nahaufnahme wartet auch der Burst.
  const other = setup(ZOOM);
  other.d.onSleep = () => {
    other.d.onSleep = null;
    assert.equal(other.m.settled(4), false);
  };
  assert.ok(await other.m.closeUp(4));
});

test("Zoom-Befehl ohne Antwort, die Kamera fährt trotzdem: Rückfahrt erfolgt", async () => {
  const { d, m } = setup(ZOOM);
  d.zoomError = (pos) => (pos === 12 ? "late" : null);
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  assert.equal(d.zoom.get(4)?.pos, 0);
  assert.deepEqual(d.saved, []);
});

test("Hand kommt, während die Zoom-Stellung gelesen wird: der Zoom fährt nicht mehr los", async () => {
  const { d, m } = setup(ZOOM);
  d.onReadZoom = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, []);
  assert.ok(d.counts.includes("camera.closeup_abort"));
  assert.deepEqual(d.saved, []);
  // Nichts verstellt, also auch nach der Sperre nichts zurückzufahren.
  d.onReadZoom = null;
  d.t += HAND_HOLD_MS;
  await m.tick();
  assert.deepEqual(d.calls, []);
});

test("Fahrzeug an der Zonen-Kamera, während die Zoom-Stellung gelesen wird: der Zoom fährt nicht mehr los", async () => {
  const { d, m } = setup(ZONE);
  d.onReadZoom = () => m.onVehicleStart(9);
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, []);
  assert.ok(d.counts.includes("camera.closeup_abort"));
});

test("Hand während der Nahaufnahme: nach der Sperre zurück, wenn der Zoom noch steht, wo die Automatik ihn hingestellt hat", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  d.onSleep = null;
  const until = d.t + HAND_HOLD_MS;
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  assert.deepEqual(d.saved, [
    { cameraId: 4, following: false, trackKey: null, zoomHome: 0, zoomAuto: [12], zoomHandUntil: until, name: "Seilbahn B" },
  ]);
  d.t = until - 1;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  d.t = until;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  assert.deepEqual(d.saved, []);
  assert.ok(d.counts.includes("camera.zoom_restore_ok"));
});

test("Hand während des zweiten, halb so weiten Versuchs: nach der Sperre zurück von der halben Position", async () => {
  const { d, m } = setup(ZOOM);
  d.boxes = [[MID], []];
  let sleeps = 0;
  d.onSleep = () => {
    if (++sleeps === 2) void m.noteHand(4);
  };
  assert.equal(await m.closeUp(4), null);
  d.onSleep = null;
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 6"]);
  assert.deepEqual(d.saved[0]?.zoomAuto, [12, 6]);
  d.t += HAND_HOLD_MS;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 6", "zoom 4 0"]);
  assert.equal(d.zoom.get(4)?.pos, 0);
  assert.deepEqual(d.saved, []);
});

test("Neuer Befehl von Hand, während die Rückfahrt die Stellung liest: keine Fahrt, sie wartet die neue Sperre ab", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  d.onSleep = null;
  d.t += HAND_HOLD_MS;
  let until = 0;
  d.onReadZoom = () => {
    d.onReadZoom = null;
    until = d.t + HAND_HOLD_MS;
    void m.noteHand(4);
  };
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  assert.equal(d.saved[0]?.zoomHandUntil, until);
  d.t = until - 1;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  d.t = until;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  assert.deepEqual(d.saved, []);
});

test("Hand während der Nahaufnahme und Zoom von Hand verstellt: die Einstellung bleibt", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  d.onSleep = null;
  d.zoom.set(4, { pos: 20, min: 0, max: 33 });
  d.t += HAND_HOLD_MS;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  assert.equal(d.zoom.get(4)?.pos, 20);
  assert.deepEqual(d.saved, []);
  assert.ok(d.counts.includes("camera.zoom_restore_skip"));
  // Erledigt: auch später fährt nichts mehr.
  d.t += HAND_HOLD_MS;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12"]);
});

test("Hand während der Nahaufnahme und Zoom von Hand zurückgestellt: nichts mehr zu tun", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  d.onSleep = null;
  d.zoom.set(4, { pos: 0, min: 0, max: 33 });
  d.t += HAND_HOLD_MS;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  assert.deepEqual(d.saved, []);
  assert.equal(d.counts.includes("camera.zoom_restore_skip"), false);
});

test("Weitere Befehle von Hand verlängern die Sperre, die Rückfahrt wartet mit", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  d.onSleep = null;
  d.t += 4 * 60_000;
  await m.noteHand(4);
  const until = d.t + HAND_HOLD_MS;
  assert.equal(d.saved[0]?.zoomHandUntil, until);
  d.t += 60_000;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  d.t = until;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
});

test("Hand übernimmt, während eine Rückfahrt aussteht: erst nach der Sperre und nur bei unveränderter Position", async () => {
  const { d, m } = setup(ZOOM, { ...ZOOM, id: 10, name: "Halle" });
  d.zoomError = (pos) => (pos === 0 ? "lost" : null);
  assert.ok(await m.closeUp(4));
  assert.ok(await m.closeUp(10));
  d.zoomError = null;
  d.t += 10_000;
  await m.noteHand(4);
  await m.noteHand(10);
  const until = d.t + HAND_HOLD_MS;
  assert.deepEqual(
    d.saved.map((s) => s.zoomHandUntil),
    [until, until]
  );
  // Kamera 10: jemand stellt den Zoom von Hand weiter herein.
  d.zoom.set(10, { pos: 16, min: 0, max: 33 });
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.equal(d.calls.length, 4);
  d.t = until;
  await m.tick();
  assert.equal(d.zoom.get(4)?.pos, 0);
  assert.equal(d.zoom.get(10)?.pos, 16);
  assert.deepEqual(d.saved, []);
});

test("Regel übernimmt während der Nahaufnahme: nach ihrer Sperre zurück, wenn der Zoom unverändert steht", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteRule(4, 30_000);
  assert.equal(await m.closeUp(4), null);
  d.onSleep = null;
  const until = d.t + 30_000;
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  d.t = until - 1;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12"]);
  d.t = until;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  assert.deepEqual(d.saved, []);
});

test("Hand übernimmt, während ein Versuch der Rückfahrt scheitert: der nächste wartet die Sperre ab", async () => {
  const { d, m } = setup(ZOOM);
  d.zoomError = (pos) => (pos === 0 ? "lost" : null);
  assert.ok(await m.closeUp(4));
  let hand: Promise<void> | null = null;
  d.zoomError = () => {
    hand ??= m.noteHand(4);
    return "lost";
  };
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  await hand;
  d.zoomError = null;
  const until = d.t + HAND_HOLD_MS;
  assert.equal(d.saved[0]?.zoomHandUntil, until);
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0", "zoom 4 0"]);
  d.t = until;
  await m.tick();
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0", "zoom 4 0", "zoom 4 0"]);
  assert.equal(d.zoom.get(4)?.pos, 0);
  assert.deepEqual(d.saved, []);
});

test("Neustart: unterbrochene Bewegung wird zurückgestellt", async () => {
  const { d, m } = setup(PTZ);
  d.stored = [{ cameraId: 5, following: true, trackKey: "bSmartTrack", zoomHome: 4 }];
  await m.restore();
  assert.deepEqual(d.calls, ['track 5 {"bSmartTrack":0}', "zoom 5 4", "guard 5 toPos"]);
  assert.deepEqual(d.saved, []);
});

test("Neustart: Zoom lässt sich noch nicht zurückfahren, die Versuche laufen weiter", async () => {
  const { d, m } = setup(ZOOM);
  d.zoom.set(4, { pos: 12, min: 0, max: 33 });
  // Datei eines älteren Stands: nur die Ausgangsstellung.
  d.stored = [{ cameraId: 4, following: false, trackKey: null, zoomHome: 0 }];
  let lose = true;
  d.zoomError = () => {
    if (!lose) return null;
    lose = false;
    return "lost";
  };
  await m.restore();
  assert.deepEqual(d.calls, ["zoom 4 0"]);
  assert.equal(d.saved[0]?.zoomHome, 0);
  // Bis dahin keine Nahaufnahme von der hereingezoomten Stellung aus.
  assert.equal(await m.closeUp(4), null);
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.equal(d.zoom.get(4)?.pos, 0);
  assert.deepEqual(d.saved, []);
});

test("Neustart nach einem Fehlversuch: die neue Instanz fährt mit dem gespeicherten Stand zurück", async () => {
  const first = setup(ZOOM);
  first.d.zoomError = (pos) => (pos === 0 ? "lost" : null);
  assert.ok(await first.m.closeUp(4));
  const second = setup(ZOOM);
  second.d.zoom.set(4, { pos: 12, min: 0, max: 33 });
  second.d.stored = first.d.saved;
  await second.m.restore();
  assert.deepEqual(second.d.calls, ["zoom 4 0"]);
  assert.equal(second.d.zoom.get(4)?.pos, 0);
  assert.deepEqual(second.d.saved, []);
});

test("Neustart während der Handsteuerung: Rückfahrt erst nach der Sperre und nur bei unveränderter Position", async () => {
  const first = setup(ZOOM);
  first.d.onSleep = () => void first.m.noteHand(4);
  assert.equal(await first.m.closeUp(4), null);
  const until = first.d.t + HAND_HOLD_MS;

  const same = setup(ZOOM);
  same.d.t = first.d.t + 60_000;
  same.d.zoom.set(4, { pos: 12, min: 0, max: 33 });
  same.d.stored = first.d.saved;
  await same.m.restore();
  assert.deepEqual(same.d.calls, []);
  assert.equal(same.d.saved[0]?.zoomHandUntil, until);
  same.d.t = until - 1;
  await same.m.tick();
  assert.deepEqual(same.d.calls, []);
  same.d.t = until;
  await same.m.tick();
  assert.deepEqual(same.d.calls, ["zoom 4 0"]);

  const changed = setup(ZOOM);
  changed.d.t = first.d.t + 60_000;
  changed.d.zoom.set(4, { pos: 20, min: 0, max: 33 });
  changed.d.stored = first.d.saved;
  await changed.m.restore();
  changed.d.t = until;
  await changed.m.tick();
  assert.deepEqual(changed.d.calls, []);
  assert.deepEqual(changed.d.saved, []);
});

test("Neustart: unlesbarer Eintrag in der Datei hält die anderen nicht auf", async () => {
  const { d, m } = setup(ZOOM);
  d.zoom.set(4, { pos: 12, min: 0, max: 33 });
  d.stored = [null as unknown as PersistedMove, { cameraId: 4, following: false, trackKey: null, zoomHome: 0 }];
  await m.restore();
  assert.deepEqual(d.calls, ["zoom 4 0"]);
  assert.deepEqual(d.saved, []);
});

test("Abgeschaltet: weder Folgen noch Nahaufnahme", async () => {
  const d = new FakeDriver();
  d.cams.set(5, PTZ);
  d.zoom.set(5, { pos: 0, min: 0, max: 33 });
  d.ai.set(5, { bSmartTrack: 0 });
  d.guards.set(5, { supported: true, exists: true });
  const m = new CameraMotion(d, { follow: false, zoom: false });
  await m.onPersonStart(5);
  assert.equal(await m.closeUp(5), null);
  assert.deepEqual(d.calls, []);
});

/** Person groß in der Mitte: Die Nahaufnahme bringt nur Faktor 1,5. */
const BIG: NormBox = { x: 0.4, y: 0.3, w: 0.2, h: 0.4 };

test("Nahaufnahme bringt die Personen-Boxen mit (für den Kopf-Ausschnitt)", async () => {
  const { m } = setup(ZOOM);
  const shot = await m.closeUp(4);
  assert.deepEqual(shot?.boxes, [MID]);
});

test("Gesichtserkennung: der Zoom fährt nur, wenn das Gesicht danach mindestens 64 px groß ist", async () => {
  const { d, m } = setup(ZOOM, { ...ZOOM, id: 10, name: "Halle" });
  // Faktor 2,4: 20 px werden 48 px, zu klein.
  assert.equal(await m.closeUp(4, { size: 20, upscaled: true }), null);
  assert.deepEqual(d.calls, []);
  assert.ok(d.counts.includes("camera.closeup_skip_face"));
  // 30 px werden 72 px: fährt.
  assert.ok(await m.closeUp(10, { size: 30, upscaled: true }));
  assert.deepEqual(d.calls, ["zoom 10 12", "zoom 10 0"]);
  // Direkt erkanntes Gesicht ohne Treffer, 96 px: fährt ebenso (Größe mal Faktor).
  const third = setup(ZOOM);
  assert.ok(await third.m.closeUp(4, { size: 96, upscaled: false }));
  assert.deepEqual(third.d.calls, ["zoom 4 12", "zoom 4 0"]);
});

test("Gesichtserkennung ohne Gesicht: erst ab Faktor 2, der Wächter schon ab 1,3", async () => {
  const { d, m } = setup(ZOOM);
  d.fallbackBoxes = [BIG];
  assert.equal(await m.closeUp(4, { size: null, upscaled: true }), null);
  assert.deepEqual(d.calls, []);
  // Der Verzicht wegen des Gesichts hält den Wächter nicht auf: Er plant sofort selbst.
  const shot = await m.closeUp(4);
  assert.ok(shot);
  assert.ok(Math.abs(shot.gain - 1.5) < 1e-9);
  assert.equal(d.calls.length, 2);
});

test("Wächter wartet auf die laufende Nahaufnahme der Gesichtserkennung; verzichtet die, plant er selbst", async () => {
  const { d, m } = setup(ZOOM);
  d.fallbackBoxes = [BIG];
  const forFace = m.closeUp(4, { size: 24, upscaled: true });
  const forSentinel = m.closeUp(4);
  assert.equal(await forFace, null);
  assert.ok(await forSentinel);
  assert.equal(d.calls.filter((c) => c.startsWith("zoom 4 ")).length, 2);
  assert.equal(d.counts.filter((c) => c === "camera.closeup_skip_face").length, 1);
});

test("Gesichtserkennung: an der Zonen-Kamera nach einem Verzicht 15 s keine neue Planung, der Wächter darf", async () => {
  const { d, m } = setup(ZONE);
  assert.equal(await m.closeUp(9, { size: 20, upscaled: true }), null);
  d.t += 14_000;
  assert.equal(await m.closeUp(9, { size: 20, upscaled: true }), null);
  assert.equal(d.counts.filter((c) => c === "camera.closeup_skip_face").length, 1);
  d.t += 1_000;
  assert.equal(await m.closeUp(9, { size: 20, upscaled: true }), null);
  assert.equal(d.counts.filter((c) => c === "camera.closeup_skip_face").length, 2);
  assert.ok(await m.closeUp(9));
  assert.deepEqual(d.calls, ["zoom 9 12", "zoom 9 0"]);
});

test("Nach einem Verzicht ohne Fahrt: nächste Planung nach 15 s, nach einer Fahrt erst nach 30 s", async () => {
  const { d, m } = setup(ZOOM);
  d.fallbackBoxes = [{ x: 0.9, y: 0.4, w: 0.08, h: 0.2 }];
  assert.equal(await m.closeUp(4), null);
  assert.equal(d.counts.filter((c) => c === "camera.closeup_skip").length, 1);
  // Die Person kommt in die Mitte.
  d.fallbackBoxes = [MID];
  d.t += 14_000;
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, []);
  d.t += 1_000;
  assert.ok(await m.closeUp(4));
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  // Nach der Fahrt: Bild 45 s im Zwischenspeicher, neue Fahrt frühestens 30 s nach dem Zoom-Befehl.
  d.t += 46_000;
  assert.ok(await m.closeUp(4));
  assert.equal(d.calls.length, 4);
});

test("Zonen-Kamera: nach einem Verzicht ohne Fahrt 15 s Pause und gleich wieder in Grundstellung, nach einer Fahrt 2 min", async () => {
  const { d, m } = setup(ZONE);
  d.fallbackBoxes = [{ x: 0.9, y: 0.4, w: 0.08, h: 0.2 }];
  assert.equal(await m.closeUp(9), null);
  assert.ok(d.counts.includes("camera.closeup_skip"));
  // Das Objektiv hat sich nicht bewegt: kein Fokus abzuwarten.
  assert.equal(m.atHome(9), true);
  // Die Person kommt in die Mitte: der Wächter bekommt nach 15 s seine Nahaufnahme.
  d.fallbackBoxes = [MID];
  d.t += 14_000;
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, []);
  d.t += 1_000;
  assert.ok(await m.closeUp(9));
  assert.deepEqual(d.calls, ["zoom 9 12", "zoom 9 0"]);
  // Nach der Fahrt: neue Nahaufnahme frühestens 2 min nach dem Zoom-Befehl.
  d.t += 60_000;
  assert.equal(await m.closeUp(9), null);
  d.t += 60_000;
  assert.ok(await m.closeUp(9));
  assert.equal(d.calls.length, 4);
});

test("Gesichtserkennung: der zweite Versuch halb so weit fährt nur, wenn er dem Gesicht noch hilft", async () => {
  const { d, m } = setup(ZOOM, { ...ZOOM, id: 10, name: "Halle" });
  // 30 px: Faktor 2,4 hilft (72 px), die Hälfte (1,7 → 51 px) nicht mehr.
  d.boxes = [[MID], []];
  assert.equal(await m.closeUp(4, { size: 30, upscaled: true }), null);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  // 40 px: auch die Hälfte hilft (68 px).
  d.boxes = [[MID], [], []];
  assert.equal(await m.closeUp(10, { size: 40, upscaled: true }), null);
  assert.deepEqual(d.calls.slice(2), ["zoom 10 12", "zoom 10 6", "zoom 10 0"]);
});

test("Raum offen: die Schwenk-Kamera folgt nicht und zählt das", async () => {
  const { d, m } = setup(PAN);
  d.room = { ...d.room, closed: false };
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, []);
  assert.deepEqual(d.events, [{ key: "follow.skip_open", data: { cam: "Shop", room: "offen" } }]);
  // Raum geschlossen: folgt, der Zähler nennt den Zustand.
  d.room = { ...d.room, closed: true };
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
  assert.deepEqual(d.events.at(-1), { key: "follow.start", data: { cam: "Shop", room: "geschlossen" } });
});

test("Betriebszustand unbekannt: nur im Nachtfenster des Wächters folgen", async () => {
  const { d, m } = setup(PAN);
  d.room = { closed: null, hour: 14, nightWindow: "22-6", always: false };
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.events, [{ key: "follow.skip_open", data: { cam: "Shop", room: "unbekannt" } }]);
  d.room = { ...d.room, hour: 23 };
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
  assert.deepEqual(d.events.at(-1), { key: "follow.start", data: { cam: "Shop", room: "unbekannt" } });
});

test("HUB_FOLLOW_ALWAYS: folgt auch bei offenem Raum", async () => {
  const { d, m } = setup(PAN);
  d.room = { ...d.room, closed: false, always: true };
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
  assert.deepEqual(d.events, [{ key: "follow.start", data: { cam: "Shop", room: "offen" } }]);
});

test("Skip wegen Pause oder Hand zählt nicht als Raum offen", async () => {
  const { d, m } = setup(PAN);
  d.room = { ...d.room, closed: false };
  await m.noteHand(7);
  await m.onPersonStart(7);
  assert.deepEqual(d.events, []);
});

test("Raum offen: die Nahaufnahme des Wächters zentriert weiter, die der Gesichtserkennung nicht", async () => {
  const sentinel = setup(PTZ);
  sentinel.d.room = { ...sentinel.d.room, closed: false };
  sentinel.d.boxes = [[LEFT], [MID], [MID]];
  assert.ok(await sentinel.m.closeUp(5));
  assert.deepEqual(sentinel.d.calls, ['track 5 {"bSmartTrack":1}', "zoom 5 3", "zoom 5 0"]);

  const face = setup(PTZ);
  face.d.room = { ...face.d.room, closed: false };
  face.d.boxes = [[LEFT]];
  // Ohne Zentrieren steht die Person am Rand: kein Zoom, kein Tracking.
  assert.equal(await face.m.closeUp(5, { size: 30, upscaled: true }), null);
  assert.deepEqual(face.d.calls, []);
  assert.equal(face.m.isFollowing(5), false);
});

/* ------------------------------------------- Tracking ohne Antwort der Kamera */

test("Tracking einschalten ohne Antwort, Kamera folgt trotzdem: gilt als Folgen und wird am Ende ausgeschaltet", async () => {
  const { d, m } = setup(PAN);
  d.trackError = (on) => (on ? "late" : null);
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
  assert.ok(d.counts.includes("follow.start_unconfirmed"));
  assert.equal(d.saved.length, 1);
  await m.onPersonEnd(7);
  assert.equal(m.isFollowing(7), false);
  assert.equal(d.ai.get(7)?.bSmartTrack, 0);
  assert.deepEqual(d.calls.slice(-2), ['track 7 {"bSmartTrack":0}', "guard 7 toPos"]);
});

test("Tracking einschalten scheitert, Kamera meldet aus: kein Folgen", async () => {
  const { d, m } = setup(PAN);
  d.trackError = (on) => (on ? "lost" : null);
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  assert.ok(d.counts.includes("follow.track_fail"));
  assert.ok(!d.counts.includes("follow.start_unconfirmed"));
  assert.equal(d.saved.length, 0);
});

test("Hand während eines Starts ohne Antwort: das Tracking ist danach aus", async () => {
  const { d, m } = setup(PAN);
  d.trackError = (on) => (on ? "late" : null);
  let release!: () => void;
  d.writeGate = new Promise<void>((r) => (release = r));
  const start = m.onPersonStart(7);
  // Warten, bis der Befehl zum Einschalten unterwegs ist.
  while (!d.writeGate) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  let handed = false;
  const hand = m.noteHand(7).then(() => (handed = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(handed, false);
  release();
  await Promise.all([start, hand]);
  assert.equal(d.ai.get(7)?.bSmartTrack, 0);
  assert.equal(m.isFollowing(7), false);
  assert.ok(d.counts.includes("follow.end_hand"));
  assert.ok(!d.calls.includes("guard 7 toPos"));
});

test("Tracking ausschalten scheitert: das Folgen bleibt gemerkt, tick versucht es nach 30 s erneut", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.trackError = (on) => (on ? null : "lost");
  await m.onPersonEnd(7);
  assert.equal(m.isFollowing(7), true);
  assert.equal(d.ai.get(7)?.bSmartTrack, 1);
  assert.ok(!d.calls.includes("guard 7 toPos"));
  assert.ok(d.counts.includes("follow.off_retry"));
  assert.equal(d.saved.length, 1);
  assert.equal(d.saved[0]?.trackKey, "bSmartTrack");
  d.trackError = null;
  d.t += 29_000;
  await m.tick();
  assert.equal(m.isFollowing(7), true);
  d.t += 1_000;
  await m.tick();
  assert.equal(m.isFollowing(7), false);
  assert.equal(d.ai.get(7)?.bSmartTrack, 0);
  assert.equal(d.calls.at(-1), "guard 7 toPos");
  assert.equal(d.saved.length, 0);
});

test("Tracking ausschalten ohne Antwort, Kamera meldet aus: erledigt", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.trackError = (on) => (on ? null : "late");
  await m.onPersonEnd(7);
  assert.equal(m.isFollowing(7), false);
  assert.ok(!d.counts.includes("follow.off_retry"));
  assert.equal(d.calls.at(-1), "guard 7 toPos");
});

test("Tracking lässt sich dauerhaft nicht ausschalten: zehn weitere Versuche, dann eine Meldung", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.trackError = (on) => (on ? null : "lost");
  await m.onPersonEnd(7);
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(d.warnings, []);
    d.t += 30_000;
    await m.tick();
  }
  assert.deepEqual(d.warnings, ["Shop: Tracking lässt sich nicht ausschalten"]);
  assert.equal(d.counts.filter((c) => c === "follow.off_retry").length, 10);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.saved, []);
});

test("Neustart: Tracking lässt sich nicht ausschalten, tick versucht es erneut und fährt dann zurück", async () => {
  const { d, m } = setup(PAN);
  d.stored = [{ cameraId: 7, following: true, trackKey: "bSmartTrack", zoomHome: null }];
  d.ai.set(7, { bSmartTrack: 1, aiTrack: 0, trackType: { people: 1, vehicle: 0 } });
  d.trackError = (on) => (on ? null : "lost");
  await m.restore();
  assert.equal(m.isFollowing(7), true);
  assert.ok(!d.calls.includes("guard 7 toPos"));
  assert.equal(d.saved.length, 1);
  d.trackError = null;
  d.t += 30_000;
  await m.tick();
  assert.equal(d.ai.get(7)?.bSmartTrack, 0);
  assert.equal(m.isFollowing(7), false);
  assert.equal(d.calls.at(-1), "guard 7 toPos");
});

test("Hand kommt, während das Folgen endet: keine Fahrt in die Grundstellung über den Befehl von Hand", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  let release!: () => void;
  d.writeGate = new Promise<void>((r) => (release = r));
  const end = m.onPersonEnd(7);
  await new Promise((r) => setImmediate(r));
  const hand = m.noteHand(7);
  release();
  await Promise.all([end, hand]);
  assert.equal(m.isFollowing(7), false);
  assert.ok(!d.calls.includes("guard 7 toPos"));
  assert.ok(d.counts.includes("follow.home_skip_hold"));
});

test("Während ein Versuch der Rückfahrt unterwegs ist, gilt die Kamera nicht als ruhig", async () => {
  const { d, m } = setup(ZOOM);
  let lose = true;
  const seen: boolean[] = [];
  d.zoomError = (pos) => {
    if (pos !== 0) return null;
    seen.push(m.settled(4));
    if (!lose) return null;
    lose = false;
    return "lost";
  };
  assert.ok(await m.closeUp(4));
  // Zwischen den Versuchen fährt nichts: ruhig.
  d.t += 5_000;
  assert.equal(m.settled(4), true);
  d.t += ZOOM_RETURN_RETRY_MS;
  await m.tick();
  assert.deepEqual(seen, [false, false]);
  // Danach der Fokus, dann wieder ruhig.
  assert.equal(m.settled(4), false);
  d.t += 3_000;
  assert.equal(m.settled(4), true);
});

test("Regel, während sich das Tracking nicht ausschalten lässt: liest sie es, gehört es ihr, tick schaltet nicht dazwischen", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.trackError = (on) => (on ? null : "lost");
  await m.onPersonEnd(7);
  assert.equal(m.isFollowing(7), true);
  // Die Regel wartet einen Versuch ab; der scheitert, ein „an“ stammt dann vom Hub.
  assert.equal(await m.noteRule(7, 60_000), true);
  const calls = d.calls.length;
  // Fällig während der Sperre: kein Versuch, die Regel bestimmt.
  d.trackError = null;
  d.t += 30_000;
  await m.tick();
  assert.equal(d.calls.length, calls);
  // Die Regel liest den Zustand und übernimmt.
  await m.ruleOwnsTracking(7);
  assert.equal(m.isFollowing(7), false);
  assert.ok(d.counts.includes("follow.handed_rule"));
  assert.deepEqual(d.saved, []);
  d.t += 60_000;
  await m.tick();
  assert.equal(d.calls.length, calls);
  // Ohne ausstehendes Ausschalten bleibt es bei false und ändert nichts.
  const other = setup(PAN);
  assert.equal(await other.m.noteRule(7, 60_000), false);
  await other.m.ruleOwnsTracking(7);
  assert.deepEqual(other.d.counts, []);
});

test("Regel liest das Tracking nicht: nach ihrer Sperre schaltet der Hub es weiter aus", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.trackError = (on) => (on ? null : "lost");
  await m.onPersonEnd(7);
  assert.equal(await m.noteRule(7, 60_000), true);
  d.trackError = null;
  d.t += 30_000;
  await m.tick();
  assert.equal(m.isFollowing(7), true);
  assert.equal(d.ai.get(7)?.bSmartTrack, 1);
  d.t += 30_000;
  await m.tick();
  assert.equal(m.isFollowing(7), false);
  assert.equal(d.ai.get(7)?.bSmartTrack, 0);
});

test("Fälliger Versuch aus tick, während die Regel ihren eigenen abwartet: kein „aus“ des Hubs danach", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.trackError = (on) => (on ? null : "lost");
  await m.onPersonEnd(7);
  // Der Versuch der Regel hängt, bis der Test ihn freigibt; währenddessen wird der nächste Termin fällig.
  let release!: () => void;
  d.writeGate = new Promise<void>((r) => (release = r));
  const rule = m.noteRule(7, 60_000);
  d.t += 30_000;
  const tick = m.tick();
  release();
  assert.equal(await rule, true);
  await tick;
  await m.ruleOwnsTracking(7);
  const offs = d.calls.filter((c) => c === 'track 7 {"bSmartTrack":0}').length;
  d.trackError = null;
  await m.tick();
  d.t += 120_000;
  await m.tick();
  assert.equal(d.calls.filter((c) => c === 'track 7 {"bSmartTrack":0}').length, offs);
  assert.equal(offs, 2);
});

test("Regel während des Zurückstellens nach einem Neustart: sie wartet es ab und sieht das Tracking des Hubs", async () => {
  const { d, m } = setup(PAN);
  d.stored = [{ cameraId: 7, following: true, trackKey: "bSmartTrack", zoomHome: null }];
  d.ai.set(7, { bSmartTrack: 1, aiTrack: 0, trackType: { people: 1, vehicle: 0 } });
  d.trackError = (on) => (on ? null : "lost");
  let release!: () => void;
  d.writeGate = new Promise<void>((r) => (release = r));
  const restored = m.restore();
  const rule = m.noteRule(7, 60_000);
  release();
  await restored;
  assert.equal(await rule, true);
});

test("Befehle von Hand vor dem nächsten Termin zählen nicht als Ausschaltversuch", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.trackError = (on) => (on ? null : "lost");
  await m.onPersonEnd(7);
  for (let i = 0; i < 12; i++) {
    d.t += 1_000;
    await m.noteHand(7);
  }
  assert.deepEqual(d.warnings, []);
  assert.equal(d.counts.filter((c) => c === "follow.off_retry").length, 1);
  assert.equal(m.isFollowing(7), true);
  // Gelingt ein Versuch von Hand, ist das Tracking aus, ohne Grundstellung.
  d.trackError = null;
  await m.noteHand(7);
  assert.equal(m.isFollowing(7), false);
  assert.equal(d.ai.get(7)?.bSmartTrack, 0);
  assert.ok(!d.calls.includes("guard 7 toPos"));
});

test("Neustart: Hand kommt, während das Tracking ausgeschaltet wird, dann keine Fahrt in die Grundstellung", async () => {
  const { d, m } = setup(PAN);
  d.stored = [{ cameraId: 7, following: true, trackKey: "bSmartTrack", zoomHome: null }];
  d.ai.set(7, { bSmartTrack: 1, aiTrack: 0, trackType: { people: 1, vehicle: 0 } });
  d.onWriteTracking = () => void m.noteHand(7);
  await m.restore();
  assert.equal(d.ai.get(7)?.bSmartTrack, 0);
  assert.ok(!d.calls.includes("guard 7 toPos"));
  // Ohne Hand wie bisher zurück.
  const other = setup(PAN);
  other.d.stored = [{ cameraId: 7, following: true, trackKey: "bSmartTrack", zoomHome: null }];
  await other.m.restore();
  assert.equal(other.d.calls.at(-1), "guard 7 toPos");
});
