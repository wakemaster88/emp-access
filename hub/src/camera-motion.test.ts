import { test } from "node:test";
import assert from "node:assert/strict";
import { CameraMotion, type GuardInfo, type MotionCam, type MotionDriver, type PersistedMove } from "./camera-motion.js";
import type { ZoomRange } from "./camera-motion-rules.js";
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
  stored: PersistedMove[] = [];
  saved: PersistedMove[] = [];
  onSleep: (() => void) | null = null;
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
    return { ...this.zoom.get(id)! };
  }
  async writeZoom(id: number, pos: number) {
    this.calls.push(`zoom ${id} ${pos}`);
    this.zoom.set(id, { ...this.zoom.get(id)!, pos });
  }
  async readTracking(id: number) {
    return { ...(this.ai.get(id) ?? {}) };
  }
  async writeTracking(id: number, patch: Record<string, unknown>) {
    this.calls.push(`track ${id} ${JSON.stringify(patch)}`);
    this.ai.set(id, { ...this.ai.get(id), ...patch });
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
    return Buffer.from(`snap ${id} ${this.t}`);
  }
  async persons() {
    return this.boxes.length ? this.boxes.shift()! : this.fallbackBoxes;
  }
  vehicleActive(id: number) {
    return this.vehicles.has(id);
  }
  async save(moves: PersistedMove[]) {
    this.saved = moves;
  }
  async load() {
    return this.stored;
  }
  log() {}
  count(kind: string, event: string) {
    this.counts.push(`${kind}.${event}`);
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

test("Neustart: unterbrochene Bewegung wird zurückgestellt", async () => {
  const { d, m } = setup(PTZ);
  d.stored = [{ cameraId: 5, following: true, trackKey: "bSmartTrack", zoomHome: 4 }];
  await m.restore();
  assert.deepEqual(d.calls, ['track 5 {"bSmartTrack":0}', "zoom 5 4", "guard 5 toPos"]);
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
