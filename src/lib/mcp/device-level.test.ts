import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceSwitchLevel } from "./device-level";

const d = (type: string, category: string | null, name = "Gerät") => ({ type, category, name });

test("Licht, Markise, Audio, Bewaesserung reichen mit operate", () => {
  assert.equal(deviceSwitchLevel(d("SHELLY", "BELEUCHTUNG", "Halle Licht")), "operate");
  assert.equal(deviceSwitchLevel(d("SHELLY", "MARKISE", "Terrasse Markise")), "operate");
  assert.equal(deviceSwitchLevel(d("HUE_LIGHT", null, "Büro Lampe")), "operate");
  assert.equal(deviceSwitchLevel(d("GARDENA_VALVE", null, "Rasen Zone 1")), "operate");
  assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", "Kasse Drucker")), "operate");
});

test("Zutritt und Unklares brauchen access", () => {
  assert.equal(deviceSwitchLevel(d("SHELLY", "TUER", "Halle")), "access");
  assert.equal(deviceSwitchLevel(d("RASPBERRY_PI", "DREHKREUZ", "Drehkreuz 1")), "access");
  assert.equal(deviceSwitchLevel(d("SHELLY", "ROLLTOR", "Halle")), "access");
  assert.equal(deviceSwitchLevel(d("SHELLY", "TASTER", "Außendusche")), "access");
  assert.equal(deviceSwitchLevel(d("NUKI_SMARTLOCK", null, "Büro")), "access");
  assert.equal(deviceSwitchLevel(d("LOQED_SMARTLOCK", null, "Lager")), "access");
  assert.equal(deviceSwitchLevel(d("SHELLY", null, "Irgendwas")), "access");
});

test("Name mit Tor/Tür macht auch einen Schalter zum Zutritt", () => {
  assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", "Tor Einfahrt")), "access");
  assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", "Werkstatt Tür")), "access");
  assert.equal(deviceSwitchLevel(d("SHELLY", "BELEUCHTUNG", "Schranke Parkplatz")), "access");
  // "Motor" enthaelt "tor", ist aber kein Tor.
  assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", "Motor Pumpe")), "operate");
});
