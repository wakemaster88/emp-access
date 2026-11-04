import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canStartTask,
  describeMower,
  mapBounds,
  mowerButtons,
  mowerTone,
  nextMowing,
  polygonCenter,
  projectOnMap,
  readMowerMap,
  sanitizeMowerMap,
  sanitizeMowerState,
  weekdaysLabel,
  zoneBadge,
  zoneLabel,
  type MowerMap,
  type MowerState,
} from "./mower";
import { buildCloudMap } from "../../hub/src/mower-map";

const hubPayload = {
  model: "Luba 3 AWD",
  label: "Luba 3 AWD",
  online: true,
  status: "MODE_WORKING",
  statusLabel: "Mäht",
  active: true,
  charging: false,
  battery: 46,
  progress: 14,
  currentZone: "area 2",
  runningTaskId: "123",
  firmware: "2.3.31.69",
  position: { lat: 52.1, lon: 8.1 },
  zones: ["area 2", "Zone 2"],
  tasks: [
    { id: "123", name: "Aufgabe-1", enabled: true, running: true, startTime: "20:00", endTime: "", weekdays: ["Di", "Do", "Sa"], bladeHeightMm: 40, zones: ["area 2"] },
    { id: "", name: "ohne ID" },
  ],
  errors: [{ code: 1005, text: "Regen" }, { text: "ohne Code" }],
  evil: "<script>",
};

test("Zustand vom Hub wird bereinigt", () => {
  const s = sanitizeMowerState(hubPayload, new Date("2026-11-04T17:00:00Z"));
  assert.ok(s);
  assert.equal(s.battery, 46);
  assert.equal(s.tasks.length, 1, "Aufgabe ohne ID fällt weg");
  assert.equal(s.errors.length, 1, "Fehler ohne Code fällt weg");
  assert.deepEqual(s.zones, ["area 2", "Zone 2"]);
  assert.equal((s as unknown as Record<string, unknown>).evil, undefined);
  assert.equal(mowerTone(s), "error");
  assert.equal(mowerTone({ ...s, errors: [] }), "mowing");
  assert.equal(mowerTone({ ...s, online: false }), "offline");
  assert.equal(sanitizeMowerState(null, new Date()), null);
});

test("Karte: nur Zahlen, Hub-Karte kommt unverändert durch", () => {
  assert.equal(sanitizeMowerMap({ w: 100, h: 100, areas: [{ name: "x", pts: "1,1 javascript:alert(1)" }] })?.areas.length, 0);
  const hub = buildCloudMap({
    areas: {
      features: [
        { geometry: { type: "Polygon", coordinates: [[[8.1, 52.1], [8.101, 52.1], [8.101, 52.101], [8.1, 52.101], [8.1, 52.1]]] }, properties: { type_name: "area", title: "area 2" } },
      ],
    },
    dock: { lat: 52.1, lon: 8.1 },
  });
  const map = sanitizeMowerMap(JSON.parse(JSON.stringify(hub)));
  assert.ok(map);
  assert.deepEqual(map, hub);
  assert.ok(readMowerMap(map));
  const p = projectOnMap(map, { lat: 52.1005, lon: 8.1005 });
  assert.ok(p && p[0] > 0 && p[0] < map.w && p[1] > 0 && p[1] < map.h);
  assert.equal(projectOnMap(map, { lat: 10, lon: 10 }), null, "weit ausserhalb wird nicht gezeichnet");
});

test("Nächste Mahd in der Zeitzone des Mandanten", () => {
  const task = { id: "1", name: "A", enabled: true, running: false, startTime: "20:00", endTime: "", weekdays: ["Di", "Do", "Sa"], bladeHeightMm: 40, zones: [] };
  // Mittwoch, 4.11.2026, 18:00 in Berlin → Donnerstag 20:00 = "morgen 20:00"
  const wed = Date.parse("2026-11-04T17:00:00Z");
  assert.equal(nextMowing([task], wed, "Europe/Berlin")?.label, "morgen 20:00");
  // Dienstag 19:00 Berlin → heute 20:00
  const tue = Date.parse("2026-11-03T18:00:00Z");
  assert.equal(nextMowing([task], tue, "Europe/Berlin")?.label, "heute 20:00");
  // Dienstag 21:00 Berlin → Do 20:00
  const tueLate = Date.parse("2026-11-03T20:00:00Z");
  assert.equal(nextMowing([task], tueLate, "Europe/Berlin")?.label, "Do 20:00");
  assert.equal(nextMowing([{ ...task, enabled: false }], wed, "Europe/Berlin"), null);
  assert.equal(weekdaysLabel(["Sa", "Di", "Do"]), "Di, Do, Sa");
});

const paused: MowerState = {
  model: "Luba 2 AWD",
  label: "Luba 2 AWD",
  online: true,
  status: "MODE_PAUSE",
  statusLabel: "Pausiert",
  active: true,
  charging: false,
  battery: 68,
  progress: 0,
  currentZone: "area 2",
  runningTaskId: null,
  firmware: "1.30.31.19",
  position: null,
  zones: ["area 1", "area 2"],
  tasks: [],
  errors: [],
  at: "2026-11-04T20:00:00Z",
};

test("Zonen heißen auf Deutsch, eigene Namen bleiben", () => {
  assert.equal(zoneLabel("area 2"), "Zone 2");
  assert.equal(zoneLabel("Area12"), "Zone 12");
  assert.equal(zoneLabel("Strandwiese"), "Strandwiese");
  assert.equal(zoneLabel(null), "");
  assert.equal(zoneBadge("area 4"), "4");
  assert.equal(zoneBadge("Große Liegewiese am See"), "Große Liege…");
});

test("Lage in Worten", () => {
  assert.deepEqual(describeMower(paused), { title: "Pausiert", detail: "in Zone 2 · 0 % geschafft", progress: true });
  assert.equal(describeMower({ ...paused, status: "MODE_WORKING", progress: 34.4 }).detail, "in Zone 2 · 34 % geschafft");
  assert.equal(describeMower({ ...paused, currentZone: null, progress: 2 }).detail, "2 % geschafft");
  const docked = { ...paused, status: "MODE_READY", active: false, charging: true, progress: null, currentZone: null };
  assert.equal(describeMower(docked).title, "Lädt");
  assert.equal(describeMower({ ...docked, battery: 100 }).title, "In der Station");
  assert.equal(describeMower({ ...docked, charging: false }).title, "Bereit");
  assert.equal(describeMower({ ...paused, online: false }).title, "Offline");
  assert.deepEqual(describeMower({ ...paused, errors: [{ code: 1005, text: "Regen erkannt" }] }), {
    title: "Störung",
    detail: "Regen erkannt",
    progress: false,
  });
});

test("Knöpfe passen zum Zustand", () => {
  const actions = (s: MowerState) => mowerButtons(s).map((b) => `${b.action}:${b.kind}`);
  assert.deepEqual(actions(paused), ["resume:primary", "dock:secondary", "stop:danger"]);
  assert.deepEqual(actions({ ...paused, status: "MODE_WORKING" }), ["pause:primary", "dock:secondary", "stop:danger"]);
  assert.deepEqual(actions({ ...paused, status: "MODE_RETURNING" }), ["pause:secondary", "stop:danger"]);
  assert.deepEqual(actions({ ...paused, status: "MODE_CHARGING_PAUSE", charging: true }), [], "lädt zwischendurch, geht von selbst weiter");
  const docked = { ...paused, status: "MODE_READY", active: false, charging: true };
  assert.deepEqual(actions(docked), []);
  assert.deepEqual(actions({ ...docked, charging: false }), ["dock:primary"]);
  assert.deepEqual(actions({ ...paused, online: false }), []);
  assert.ok(mowerButtons(paused).find((b) => b.action === "stop")?.confirm, "Beenden nur mit Bestätigung");
  assert.equal(canStartTask(docked), true);
  assert.equal(canStartTask(paused), false);
  assert.equal(canStartTask({ ...docked, online: false }), false);
});

test("Kartenausschnitt zeigt nur die Wiesen", () => {
  const map: MowerMap = {
    v: 1,
    w: 1000,
    h: 1000,
    areas: [{ name: "area 1", pts: "400,100 600,100 600,900 400,900" }],
    obstacles: [],
    paths: [],
    dock: null,
    proj: null,
  };
  const box = mapBounds(map);
  assert.ok(box.w < 300 && box.h > 800, "schmaler Streifen statt ganzer Karte");
  assert.ok(box.x < 400 && box.x + box.w > 600 && box.y < 100 && box.y + box.h > 900);
  const withPos = mapBounds(map, [[700, 500]]);
  assert.ok(withPos.x + withPos.w > 700, "Position bleibt im Bild");
  assert.deepEqual(mapBounds({ ...map, areas: [] }), { x: 0, y: 0, w: 1000, h: 1000 });
  assert.deepEqual(polygonCenter("0,0 10,0 10,10 0,10"), [5, 5]);
  assert.equal(polygonCenter("0,0 1,1"), null);
});
