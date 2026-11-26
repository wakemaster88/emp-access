import { test } from "node:test";
import assert from "node:assert/strict";
import { apiProbeCandidates, cameraNetOf, probeLoginOutcome, type ProbeScanDevice } from "./camera-probe-rules.js";

const WANTED = "02:00:5E:10:00:21";
const dev = (ip: string, over: Partial<ProbeScanDevice> = {}): ProbeScanDevice => ({
  ip,
  mac: null,
  vendor: null,
  openPorts: [554],
  ...over,
});

// Letztes Subnetz der Kamera 192.0.2.0/24, Kamera-Netz 198.51.100.0/24, fremd 203.0.113.0/24.
const scan = [
  dev("192.0.2.21"),
  dev("192.0.2.22", { mac: WANTED.toLowerCase() }),
  dev("192.0.2.23", { mac: "02:00:5E:10:00:99" }),
  dev("192.0.2.24", { openPorts: [80, 443] }),
  dev("192.0.2.25", { openPorts: [80], vendor: "Reolink Innovation" }),
  dev("192.0.2.26", { shelly: { gen: 2 } }),
  dev("198.51.100.31"),
  dev("203.0.113.41"),
  dev("192.0.2.21"),
];

test("Nur im letzten Subnetz und im Kamera-Netz, das letzte Subnetz zuerst", () => {
  // Das Kamera-Netz steht im Scan vorn, kommt aber nach dem letzten Subnetz.
  const order = [scan[6], ...scan.slice(0, 6), ...scan.slice(7)];
  assert.deepEqual(apiProbeCandidates(order, new Set(), WANTED, "192.0.2.17/24", "198.51.100.0/24"), [
    "192.0.2.21",
    "192.0.2.22",
    "192.0.2.25",
    "198.51.100.31",
  ]);
});

test("Ohne erkennbares Kamera-Netz nur das letzte Subnetz", () => {
  assert.deepEqual(apiProbeCandidates(scan, new Set(), WANTED, "192.0.2.17/24", null), [
    "192.0.2.21",
    "192.0.2.22",
    "192.0.2.25",
  ]);
  // Ohne beides (Adresse kein IPv4, kein Kamera-Netz): niemand.
  assert.deepEqual(apiProbeCandidates(scan, new Set(), WANTED, null, null), []);
});

test("Nie Adressen eingerichteter Geraete, nie Geraete mit fremder MAC, nur moegliche Kameras", () => {
  const taken = new Set(["192.0.2.21", "198.51.100.31"]);
  assert.deepEqual(apiProbeCandidates(scan, taken, WANTED, "192.0.2.0/24", "198.51.100.0/24"), [
    "192.0.2.22",
    "192.0.2.25",
  ]);
});

test("Kamera-Netz aus der Einstellung der Netze am Namen", () => {
  assert.equal(
    cameraNetOf([
      { name: "Management", cidr: "192.0.2.0/24" },
      { name: "Kameras", cidr: "198.51.100.0/24" },
      { name: "Video", cidr: "203.0.113.0/24" },
    ]),
    "198.51.100.0/24"
  );
  assert.equal(cameraNetOf([{ name: "CCTV", cidr: "203.0.113.0/24" }]), "203.0.113.0/24");
  assert.equal(cameraNetOf([{ name: "Betrieb", cidr: "192.0.2.0/24" }]), null);
  assert.equal(cameraNetOf([]), null);
});

test("Anmeldung an einer fremden Adresse: was als Ablehnung zaehlt", () => {
  const err = (message: string, name = "Error") => ({ name, message });
  assert.equal(probeLoginOutcome(err("HTTP 401")), "abgelehnt");
  assert.equal(probeLoginOutcome(err("HTTP 403")), "abgelehnt");
  assert.equal(probeLoginOutcome(err("Login fehlgeschlagen: login failed (rspCode -7)")), "abgelehnt");
  assert.equal(probeLoginOutcome(err("Login fehlgeschlagen: unbekannt (rspCode -7)")), "abgelehnt");
  assert.equal(probeLoginOutcome(err("Login fehlgeschlagen: invalid user or password (rspCode undefined)")), "abgelehnt");
  // Andere Antworten: kein Nein zu den Zugangsdaten.
  assert.equal(probeLoginOutcome(err("HTTP 404")), "anders");
  assert.equal(probeLoginOutcome(err("Login fehlgeschlagen: max session (rspCode -5)")), "anders");
  assert.equal(probeLoginOutcome(err("Login ohne Token beantwortet")), "anders");
  assert.equal(probeLoginOutcome(err("Unexpected token '<'", "SyntaxError")), "anders");
  // Keine Antwort.
  assert.equal(probeLoginOutcome(err("fetch failed", "TypeError")), "keine");
  assert.equal(probeLoginOutcome(err("The operation was aborted due to timeout", "TimeoutError")), "keine");
});
