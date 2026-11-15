import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveWarnings, summarizeCameraActivity, type LiveWarningInput } from "./dashboard-live";

const now = new Date("2026-07-12T14:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

function input(over: Partial<LiveWarningInput> = {}): LiveWarningInput {
  return {
    now,
    monitorAlerts: [],
    monitorAlertsOpen: 0,
    hubs: [{ name: "mac-studio", online: true, outdated: false }],
    hubAlerts: [],
    camerasOffline: [],
    devicesOffline: [],
    blacklistSightings: [],
    noParking: [],
    gates: [],
    areas: [],
    anny: null,
    ...over,
  };
}

test("ruhiger Betrieb: keine Warnung", () => {
  assert.deepEqual(buildLiveWarnings(input()), []);
});

test("Rot steht vor Gelb, gesperrte Person ganz oben", () => {
  const w = buildLiveWarnings(
    input({
      camerasOffline: ["Halle"],
      hubs: [{ name: "mac-studio", online: false, outdated: false }],
      blacklistSightings: [{ id: 7, name: "Max M.", cameraName: "Eingang", seenAt: ago(3) }],
      monitorAlerts: [{ id: 1, message: "Zwei Personen", source: "Seilbahn A", occurredAt: ago(10) }],
      monitorAlertsOpen: 2,
    }),
  );
  assert.deepEqual(
    w.map((x) => x.key),
    ["blacklist:7", "monitor-alerts", "hub-offline", "cameras-offline"],
  );
  assert.equal(w[0].tone, "danger");
  assert.equal(w[1].title, "2 offene Warnungen am Drehkreuz");
  assert.equal(w[1].detail, "Seilbahn A: Zwei Personen");
  assert.equal(w[3].tone, "warning");
});

test("Bereich: über dem Limit und viele Ablehnungen", () => {
  const w = buildLiveWarnings(
    input({
      areas: [
        { id: 8, name: "Strandbad", personLimit: 100, inside: 120, denied15: 2 },
        { id: 5, name: "Seilbahn A", personLimit: 50, inside: null, denied15: 5 },
        { id: 6, name: "Sauna", personLimit: 20, inside: 20, denied15: 4 },
      ],
    }),
  );
  assert.deepEqual(
    w.map((x) => x.key),
    ["over-limit:8", "denied:5"],
  );
  assert.equal(w[0].href, "/areas/8");
});

test("Tor: offen gehalten ist ein Hinweis, ein Fehler dabei eine Störung", () => {
  const hold = buildLiveWarnings(input({ gates: [{ name: "Tor", holdUntil: ago(-30), holdError: null }] }));
  assert.equal(hold.length, 1);
  assert.equal(hold[0].tone, "warning");

  const failed = buildLiveWarnings(input({ gates: [{ name: "Tor", holdUntil: ago(-30), holdError: "timeout" }] }));
  assert.equal(failed.length, 1);
  assert.equal(failed[0].tone, "danger");

  // Abgelaufenes Offenhalten meldet nichts mehr, auch nicht den alten Fehler.
  assert.deepEqual(buildLiveWarnings(input({ gates: [{ name: "Tor", holdUntil: ago(5), holdError: "timeout" }] })), []);
});

test("Hub-Befunde: alert einzeln und rot, warn zusammengefasst", () => {
  const w = buildLiveWarnings(
    input({
      hubAlerts: [
        { key: "a", title: "Switch ohne Antwort", detail: null, severity: "alert", lastSeenAt: ago(1) },
        { key: "b", title: "VLAN 7 fehlt", detail: "Port 3", severity: "warn", lastSeenAt: ago(2) },
        { key: "c", title: "VLAN 9 fehlt", detail: "Port 4", severity: "warn", lastSeenAt: ago(3) },
      ],
    }),
  );
  assert.deepEqual(
    w.map((x) => [x.key, x.tone]),
    [
      ["hub-alert:a", "danger"],
      ["hub-alerts", "warning"],
    ],
  );
  assert.equal(w[1].title, "2 Befunde im Netzwerk");
});

test("ANNY: Fehler oder alter Stand melden, frischer Stand nicht", () => {
  assert.equal(buildLiveWarnings(input({ anny: { lastSync: ago(10), errors: 0 } })).length, 0);
  assert.equal(buildLiveWarnings(input({ anny: { lastSync: ago(10), errors: 2 } }))[0].title, "ANNY-Abgleich mit 2 Fehlern");
  assert.equal(buildLiveWarnings(input({ anny: { lastSync: ago(180), errors: 0 } }))[0].title, "ANNY-Abgleich hängt");
});

test("Kamera-Aktivität: je Kamera gezählt, jüngste zuerst", () => {
  const cams = summarizeCameraActivity([
    { cameraId: 1, cameraName: "Eingang", type: "PERSON", startedAt: ago(30) },
    { cameraId: 2, cameraName: "Halle", type: "VEHICLE", startedAt: ago(5) },
    { cameraId: 1, cameraName: "Eingang", type: "MOTION", startedAt: ago(20) },
    { cameraId: 1, cameraName: "Eingang", type: "PERSON", startedAt: ago(40) },
  ]);
  assert.deepEqual(
    cams.map((c) => [c.name, c.person, c.vehicle, c.other, c.total]),
    [
      ["Halle", 0, 1, 0, 1],
      ["Eingang", 2, 0, 1, 3],
    ],
  );
  assert.equal(cams[1].lastAt, ago(20).toISOString());
});
