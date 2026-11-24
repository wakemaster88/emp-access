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

test("Komposita mit Tor/Tür zählen als Zutritt", () => {
  for (const name of ["Schiebetor", "Rolltor", "Hoftor", "Gartentür", "Haustuer", "Nebeneingang", "Parkplatzschranke", "Torhaus"]) {
    assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", name)), "access", name);
  }
  assert.equal(deviceSwitchLevel(d("HUE_LIGHT", null, "Einfahrt Laterne")), "access");
});

test("Schreibung mit ß, Pforte und Gatter zählen als Zutritt", () => {
  for (const name of ["Schloß Halle", "Gartenschloß", "SCHLOß", "Pforte Süd", "Gartenpforte", "Gatter Weide", "Hofgatter"]) {
    assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", name)), "access", name);
  }
});

test("Zerlegte Umlaute (NFD) zählen wie zusammengesetzte", () => {
  for (const name of ["Tür Halle".normalize("NFD"), "Gartentür".normalize("NFD")]) {
    assert.notEqual(name, name.normalize("NFC"));
    assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", name)), "access", name);
  }
});

test("Wörter, die nur zufällig 'tor' enthalten, bleiben operate", () => {
  for (const name of ["Motorraum-Licht", "Monitor-Steckdose", "Ventilator Halle", "Generator", "Kompressor", "Projektor Saal", "Hue Gateway"]) {
    assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", name)), "operate", name);
  }
  // Ausnahme-Wort neben einem echten Tor: bleibt Zutritt
  assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", "Motor Schiebetor")), "access");
  assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", "Torantrieb Motor")), "access");
});

test("Geräte, die anderswo Zutritt öffnen, brauchen access", () => {
  assert.equal(deviceSwitchLevel(d("SHELLY", "SCHALTER", "Relais 3"), true), "access");
  assert.equal(deviceSwitchLevel(d("SHELLY", "BELEUCHTUNG", "Halle Licht"), true), "access");
  assert.equal(deviceSwitchLevel(d("SHELLY", "BELEUCHTUNG", "Halle Licht"), false), "operate");
});
