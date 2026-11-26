/**
 * Geraetetyp-Erkennung des Netzwerk-Scans (scanner.ts) aus offenen Ports,
 * Hostname, Hersteller und Shelly-Probe. Die Reihenfolge der Regeln
 * entscheidet: Die erste passende gewinnt. Hostnamen sind erfunden.
 *
 * scanner.ts liest beim Laden die Hub-Einstellungen (config.ts); der Test
 * setzt die zwei Pflichtwerte vorher und laedt das Modul danach.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { ShellyInfo } from "./shelly.js";

type Scanner = typeof import("./scanner.js");
let guess: Scanner["guessDeviceType"];

before(async () => {
  process.env.HUB_API_URL ??= "http://127.0.0.1:9";
  process.env.HUB_API_TOKEN ??= "test";
  process.env.HUB_IMPROVE_LOG = "0";
  ({ guessDeviceType: guess } = await import("./scanner.js"));
});

const shelly = (over: Partial<ShellyInfo> = {}): ShellyInfo => ({
  gen: 2,
  model: "SPSW-104PE16EU",
  app: "Pro4PM",
  name: null,
  fw: null,
  auth: false,
  ...over,
});

test("Shelly: App-Name vor Modell, Shelly schlaegt jede andere Regel", () => {
  assert.equal(guess([80], null, null, shelly()), "Shelly Pro4PM");
  assert.equal(guess([80], null, null, shelly({ app: null })), "Shelly SPSW-104PE16EU");
  assert.equal(guess([80], null, null, shelly({ app: null, model: null })), "Shelly");
  assert.equal(guess([554, 80], "kamera-test", "Reolink", shelly()), "Shelly Pro4PM");
});

test("Hersteller und Hostname: DoorBird vor Reolink, Reolink vor allen Ports", () => {
  assert.equal(guess([80, 554], null, "DoorBird"), "Türstation");
  assert.equal(guess([], "doorbird-test", null), "Türstation");
  assert.equal(guess([], null, "Bird Home Automation GmbH"), "Türstation");
  assert.equal(guess([9100], null, "Reolink"), "Kamera");
});

test("Ports: Soundweb (1023 ohne 22), Drucker, Kamera, Medienserver, iPhone, Windows, NAS", () => {
  assert.equal(guess([80, 1023], null, null), "Audio-DSP (Soundweb)");
  assert.equal(guess([22, 1023], null, null), "Server/PC");
  assert.equal(guess([9100], null, null), "Drucker");
  assert.equal(guess([515], null, null), "Drucker");
  assert.equal(guess([631, 80], null, null), "Drucker");
  assert.equal(guess([554], null, null), "Kamera");
  assert.equal(guess([32400], null, null), "Medienserver");
  assert.equal(guess([62078], null, null), "iPhone/iPad");
  assert.equal(guess([3389], null, null), "Windows-PC");
  assert.equal(guess([445], null, null), "NAS/Server");
  assert.equal(guess([548], null, null), "NAS/Server");
});

test("Hostname: Drucker, Kamera, Medienserver, iPhone, NAS und IoT", () => {
  assert.equal(guess([], "Printer-Test.local", null), "Drucker");
  assert.equal(guess([], "ipcam-test", null), "Kamera");
  assert.equal(guess([], "plex-test", null), "Medienserver");
  assert.equal(guess([], "iphone-test", null), "iPhone/iPad");
  assert.equal(guess([], "nas-test", null), "NAS/Server");
  assert.equal(guess([], null, "Synology"), "NAS/Server");
  assert.equal(guess([], "sonos-test", null), "IoT-Gerät");
  assert.equal(guess([1883], null, null), "IoT-Gerät");
  assert.equal(guess([8883], null, null), "IoT-Gerät");
});

test("Raspberry Pi nur mit SSH, Web-Port und passendem Hersteller", () => {
  assert.equal(guess([22, 80], null, "Raspberry Pi"), "Raspberry Pi");
  assert.equal(guess([22, 443], null, "Raspberry Pi Trading"), "Raspberry Pi");
  assert.equal(guess([22], null, "Raspberry Pi"), "Server/PC");
  assert.equal(guess([22, 80], null, null), "Web-Gerät");
});

test("Netzwerk-Geraete an Hostname oder Hersteller, danach Web-Geraet, Server und nichts", () => {
  assert.equal(guess([80], "switch-test", null), "Netzwerk (Switch/AP/Router)");
  assert.equal(guess([], "gc108-test", null), "Netzwerk (Switch/AP/Router)");
  assert.equal(guess([443], null, "Netgear"), "Netzwerk (Switch/AP/Router)");
  assert.equal(guess([443], null, "Ubiquiti Inc"), "Netzwerk (Switch/AP/Router)");
  assert.equal(guess([8080], null, null), "Web-Gerät");
  assert.equal(guess([443], null, null), "Web-Gerät");
  assert.equal(guess([22], null, null), "Server/PC");
  assert.equal(guess([21, 23, 53], null, null), null);
  assert.equal(guess([], null, null), null);
});

test("Gross- und Kleinschreibung von Hostname und Hersteller spielt keine Rolle", () => {
  assert.equal(guess([], "DOORBIRD-TEST", null), "Türstation");
  assert.equal(guess([], null, "REOLINK"), "Kamera");
  assert.equal(guess([], "Plex-Test", null), "Medienserver");
});
