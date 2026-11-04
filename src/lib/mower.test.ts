import { test } from "node:test";
import assert from "node:assert/strict";
import { mowerTone, nextMowing, projectOnMap, readMowerMap, sanitizeMowerMap, sanitizeMowerState, weekdaysLabel } from "./mower";
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
