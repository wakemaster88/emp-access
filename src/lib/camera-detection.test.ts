import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDetectionSettings, parseSentinelMode, parseZoneInput } from "./camera-detection";

const base = {
  vehicleDetection: true,
  vehicleMinArea: null,
  vehicleZone: null,
  noParkDetection: false,
  noParkZone: null,
  noParkMinutes: null,
  deliveryMode: null,
  deliveryFrom: null,
  deliveryTo: null,
  sentinelMode: null,
};
const tri = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]];

test("parseZoneInput: leer heisst keine Zone, ungueltige Punkte werden abgelehnt", () => {
  assert.equal(parseZoneInput([]), null);
  assert.equal(parseZoneInput(null), null);
  assert.equal(parseZoneInput([[0, 0], [1, 1]]), "invalid");
  assert.equal(parseZoneInput([[0, 0], [1, 1], [2, 0]]), "invalid");
  assert.deepEqual(parseZoneInput([[0.123456, 0], [1, 1], [0, 1]]), [[0.1235, 0], [1, 1], [0, 1]]);
});

test("mergeDetectionSettings: nur uebergebene Felder aendern sich", () => {
  const r = mergeDetectionSettings({ ...base, vehicleMinArea: 0.03 }, { vehicleDetection: false });
  assert.ok("settings" in r);
  assert.equal(r.settings.vehicleDetection, false);
  assert.equal(r.settings.vehicleMinArea, 0.03);
});

test("mergeDetectionSettings: Halteverbot braucht eine Flaeche", () => {
  assert.ok("error" in mergeDetectionSettings(base, { noParkDetection: true }));
  const ok = mergeDetectionSettings(base, { noParkDetection: true, noParkZone: tri });
  assert.ok("settings" in ok && ok.settings.noParkDetection);
  const zoneGone = mergeDetectionSettings({ ...base, noParkDetection: true, noParkZone: tri }, { noParkZone: [] });
  assert.ok("error" in zoneGone);
});

test("mergeDetectionSettings: Grenzen fuer Mindestgroesse und Standzeit", () => {
  assert.ok("error" in mergeDetectionSettings(base, { vehicleMinArea: 0.6 }));
  assert.ok("error" in mergeDetectionSettings(base, { noParkMinutes: 0.1 }));
  const r = mergeDetectionSettings(base, { vehicleMinArea: "", noParkMinutes: 5 });
  assert.ok("settings" in r && r.settings.vehicleMinArea === null && r.settings.noParkMinutes === 5);
});

test("Lieferdienste: Modus und Zeitfenster pruefen", () => {
  assert.ok("error" in mergeDetectionSettings(base, { deliveryMode: "AUF" }));
  assert.ok("error" in mergeDetectionSettings(base, { deliveryMode: "OPEN", deliveryFrom: "7 Uhr" }));
  assert.ok("error" in mergeDetectionSettings({ ...base, vehicleDetection: false }, { deliveryMode: "NOTIFY" }));
  const r = mergeDetectionSettings(base, { deliveryMode: "OPEN", deliveryFrom: "07:30", deliveryTo: "" });
  assert.ok("settings" in r);
  if ("settings" in r) {
    assert.equal(r.settings.deliveryMode, "OPEN");
    assert.equal(r.settings.deliveryFrom, "07:30");
    assert.equal(r.settings.deliveryTo, null);
  }
  const off = mergeDetectionSettings({ ...base, deliveryMode: "OPEN" }, { deliveryMode: null });
  assert.ok("settings" in off && off.settings.deliveryMode === null);
});

test("Wächter: wie der Raum (null), nur nachts, aus; andere Werte werden abgelehnt", () => {
  assert.equal(parseSentinelMode(null), null);
  assert.equal(parseSentinelMode(""), null);
  assert.equal(parseSentinelMode("NIGHT"), "NIGHT");
  assert.equal(parseSentinelMode("OFF"), "OFF");
  assert.equal(parseSentinelMode("night"), "invalid");
  assert.equal(parseSentinelMode(1), "invalid");

  const night = mergeDetectionSettings(base, { sentinelMode: "NIGHT" });
  assert.ok("settings" in night && night.settings.sentinelMode === "NIGHT");
  // Ohne das Feld (ältere Oberfläche) bleibt der gespeicherte Wert.
  const kept = mergeDetectionSettings({ ...base, sentinelMode: "OFF" }, { vehicleDetection: false });
  assert.ok("settings" in kept && kept.settings.sentinelMode === "OFF");
  const back = mergeDetectionSettings({ ...base, sentinelMode: "OFF" }, { sentinelMode: "" });
  assert.ok("settings" in back && back.settings.sentinelMode === null);
  assert.ok("error" in mergeDetectionSettings(base, { sentinelMode: "TAG" }));
});
