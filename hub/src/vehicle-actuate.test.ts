/**
 * Verdrahtung der Schalt-Entscheidung am echten Modul (plate.ts,
 * vehicle-actuate.ts), ohne Gerät: Die Regeln selbst sind in den
 * *-rules.test.ts geprüft, hier, dass actuateIfAllowed und findAllowedVehicle
 * sie auch anwenden. Die Cloud ist eine Attrappe auf 127.0.0.1; es gibt
 * keine DoorBird und keinen Shelly, geschaltet wird also nie etwas.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Plate = typeof import("./plate.js");
type Actuate = typeof import("./vehicle-actuate.js");

const alerts: Array<{ source: string; keys: string[] }> = [];
let server: http.Server;
let plate: Plate;
let actuate: Actuate;
const realNow = Date.now;
let offset = 0;

const H = 3_600_000;

function vehicle(id: number, plateText: string, plateNormalized: string) {
  return {
    id,
    name: `Testwagen ${id}`,
    plate: plateText,
    plateNormalized,
    cameraId: null,
    doorbirdCameraId: null,
    cooldownMinutes: 2,
    lastTriggeredAt: null,
    shellyAction: "ON",
    timerSeconds: null,
    shellyIp: null,
    shellyLinked: false,
  };
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.url?.startsWith("/api/hub/alerts")) {
        const j = JSON.parse(body || "{}") as { source?: string; alerts?: Array<{ key: string }> };
        alerts.push({ source: String(j.source), keys: (j.alerts ?? []).map((a) => a.key) });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  // Vor dem Import: config.ts liest die Umgebung beim Laden, hub/.env
  // überschreibt gesetzte Werte nicht.
  process.env.HUB_API_URL = `http://127.0.0.1:${port}`;
  process.env.HUB_API_TOKEN = "test";
  process.env.HUB_IMPROVE_LOG = "0";
  process.env.HUB_WHITELIST_MAX_AGE_H = "168";
  process.env.HUB_DOORBIRD_FALLBACK = "";
  process.env.HUB_NAME = "Testhub";
  Date.now = () => realNow() + offset;
  plate = await import("./plate.js");
  actuate = await import("./vehicle-actuate.js");
});

after(() => {
  Date.now = realNow;
  server.close();
});

test("Fahrzeugliste: ein Kreis mit Umlaut trifft auch ohne Umlaut gelesen, alle Zeichen gleich", () => {
  offset = 0;
  plate.setVehicleWhitelist([vehicle(1, "LÜD-AB 123", "LUEDAB123"), vehicle(2, "GT-AB 4321", "GTAB4321")]);
  assert.equal(plate.findAllowedVehicle("LUD-AB 123")?.id, 1);
  assert.equal(plate.findAllowedVehicle("LÜD-AB 123")?.id, 1);
  assert.equal(plate.findAllowedVehicle("LUD-AB 124"), null);
  assert.equal(plate.findAllowedVehicle("GT-AB 4321")?.id, 2);
});

test("Schalten: ohne lokale Aktoren entscheidet die Cloud, ein unsicherer Treffer schaltet nirgends", async () => {
  offset = 0;
  plate.setVehicleWhitelist([vehicle(2, "GT-AB 4321", "GTAB4321")]);
  const r = await actuate.actuateIfAllowed({ cameraId: 4, plate: "GT-AB 4321", exact: true, confidence: 0.97 });
  // setVehicleWhitelist meldet keine lokalen Aktoren: Die Cloud entscheidet.
  assert.equal(r, null);
  // Zu unsicher: weder lokal noch ersatzweise über die Cloud.
  const unsure = await actuate.actuateIfAllowed({ cameraId: 4, plate: "GT-AB 4321", exact: false, confidence: 0.97 });
  assert.equal(unsure?.skipCloud, true);
  assert.equal(unsure?.doorOpened, false);
});

test("Schalten: Fahrzeugliste älter als HUB_WHITELIST_MAX_AGE_H – kein Kennzeichen öffnet, auch nicht über die Cloud", async () => {
  offset = 0;
  plate.setVehicleWhitelist([vehicle(2, "GT-AB 4321", "GTAB4321")]);
  assert.equal(plate.whitelistMayActuate(), true);
  offset = 169 * H;
  const r = await actuate.actuateIfAllowed({ cameraId: 4, plate: "GT-AB 4321", exact: true, confidence: 0.97 });
  assert.ok(r, "Listen-Fahrzeug erkannt");
  assert.equal(r.skipCloud, true);
  assert.equal(r.doorOpened, false);
  assert.equal(r.shellyTriggered, false);
  // Erkennung läuft weiter.
  assert.equal(plate.findAllowedVehicle("GT-AB 4321")?.id, 2);
  // Der Befund geht an die Cloud (Quelle fahrzeugliste je Hub).
  for (let i = 0; i < 50 && !alerts.some((a) => a.keys.length > 0); i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(alerts.at(-1), { source: "fahrzeugliste-testhub", keys: ["fahrzeugliste-testhub:zu-alt"] });
  // Eine neue Liste hebt die Sperre auf.
  plate.setVehicleWhitelist([vehicle(2, "GT-AB 4321", "GTAB4321")]);
  assert.equal(plate.whitelistMayActuate(), true);
});
