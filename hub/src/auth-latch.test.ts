import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_SINGLE_TRY_MS,
  authAlertSource,
  authOutcome,
  credentialFingerprint,
  latchGate,
  latchLocked,
  latchNote,
  parseLatchFile,
  probeAllowed,
  probeMarkAfter,
  serializeLatchFile,
  type AuthOutcome,
  type LatchEntry,
} from "./auth-latch.js";

const NOW = Date.UTC(2026, 10, 26, 9, 0, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const FP = credentialFingerprint("192.0.2.30", 80, false, "nutzer", "beispiel");
const OTHER = credentialFingerprint("192.0.2.30", 80, false, "nutzer", "neu");

/** Versuche nacheinander durchspielen, wie DoorBird, Shelly und Suche es tun. */
function run(steps: Array<{ at: number; outcome: AuthOutcome; fp?: string; rev?: string | null }>) {
  let entry: LatchEntry | null = null;
  const out: Array<{ allow: boolean; locked: boolean; released: string | boolean | null }> = [];
  for (const s of steps) {
    const fp = s.fp ?? FP;
    const g = latchGate(entry, fp, s.at, s.rev ?? null);
    entry = g.entry;
    if (!g.allow) {
      out.push({ allow: false, locked: true, released: null });
      continue;
    }
    const n = latchNote(entry, fp, s.outcome, s.at, s.rev ?? null);
    entry = n.entry;
    out.push({ allow: true, locked: latchLocked(entry, fp, s.rev ?? null), released: g.released ?? n.released });
  }
  return { out, entry };
}

test("Antworten: 401 und 403 sind Ablehnungen, 2xx angenommen", () => {
  assert.equal(authOutcome(401), "abgelehnt");
  assert.equal(authOutcome(403), "abgelehnt");
  assert.equal(authOutcome(200), "ok");
  assert.equal(authOutcome(204), "ok");
  assert.equal(authOutcome(404), "anders");
  assert.equal(authOutcome(503), "anders");
  assert.equal(authOutcome(null), "keine");
});

test("Nach zwei Ablehnungen in Folge keine weiteren Versuche", () => {
  const { out } = run([
    { at: NOW, outcome: "abgelehnt" },
    { at: NOW + 3_000, outcome: "abgelehnt" },
    { at: NOW + 60_000, outcome: "abgelehnt" },
    { at: NOW + 60 * MIN, outcome: "abgelehnt" },
  ]);
  assert.deepEqual(
    out.map((o) => [o.allow, o.locked]),
    [
      [true, false],
      [true, true],
      [false, true],
      [false, true],
    ]
  );
  // Eine einzelne Ablehnung sperrt nicht.
  assert.equal(run([{ at: NOW, outcome: "abgelehnt" }, { at: NOW + 3_000, outcome: "ok" }]).entry, null);
});

test("Gesperrt: ein einzelner Versuch je 24 Stunden, danach wieder gesperrt", () => {
  const { entry } = run([
    { at: NOW, outcome: "abgelehnt" },
    { at: NOW + 3_000, outcome: "abgelehnt" },
  ]);
  const locked = entry!;
  const g1 = latchGate(locked, FP, NOW + 3_000 + AUTH_SINGLE_TRY_MS - 1);
  assert.equal(g1.allow, false);
  assert.equal(g1.nextTryAt, NOW + 3_000 + AUTH_SINGLE_TRY_MS);
  const g2 = latchGate(locked, FP, NOW + 3_000 + AUTH_SINGLE_TRY_MS);
  assert.equal(g2.allow, true);
  assert.equal(g2.single, true);
  // Der Versuch zaehlt schon vor der Antwort: ein zweiter Aufrufer daneben wartet.
  assert.equal(latchGate(g2.entry, FP, NOW + 3_000 + AUTH_SINGLE_TRY_MS + 1).allow, false);
  // Wieder abgelehnt: gesperrt, naechster Versuch 24 h spaeter.
  const n = latchNote(g2.entry, FP, "abgelehnt", NOW + 3_000 + AUTH_SINGLE_TRY_MS);
  assert.equal(n.locked, false, "nicht neu gesperrt, die Sperre gilt weiter");
  assert.equal(latchLocked(n.entry, FP), true);
  assert.equal(latchGate(n.entry, FP, NOW + 3_000 + 2 * AUTH_SINGLE_TRY_MS - 1).allow, false);
  // Keine Antwort auf den einzelnen Versuch: gesperrt wie vorher.
  assert.equal(latchLocked(latchNote(g2.entry, FP, "keine", NOW + DAY).entry, FP), true);
  assert.equal(latchLocked(latchNote(g2.entry, FP, "anders", NOW + DAY).entry, FP), true);
});

test("Sperre loest sich: Versuch gelingt", () => {
  const { entry } = run([
    { at: NOW, outcome: "abgelehnt" },
    { at: NOW + 3_000, outcome: "abgelehnt" },
  ]);
  const g = latchGate(entry, FP, NOW + DAY + 3_000);
  const n = latchNote(g.entry, FP, "ok", NOW + DAY + 3_000);
  assert.deepEqual(n, { entry: null, locked: false, released: true });
  // Ohne Sperre ist ein Erfolg keine Loesung.
  assert.equal(latchNote(null, FP, "ok", NOW).released, false);
});

test("Sperre loest sich: andere Zugangsdaten, und die Folge beginnt von vorn", () => {
  const { out, entry } = run([
    { at: NOW, outcome: "abgelehnt" },
    { at: NOW + 3_000, outcome: "abgelehnt" },
    { at: NOW + 5 * MIN, outcome: "abgelehnt", fp: OTHER },
  ]);
  assert.deepEqual(out[2], { allow: true, locked: false, released: "zugangsdaten" });
  assert.equal(entry?.rejections, 1);
  assert.equal(entry?.fp, OTHER);
});

test("Gesperrt gilt nur fuer die abgelehnten Zugangsdaten: mit neuen meldet der Hub keine Sperre mehr", () => {
  const { entry } = run([
    { at: NOW, outcome: "abgelehnt" },
    { at: NOW + 3_000, outcome: "abgelehnt" },
  ]);
  // Noch vor dem naechsten Versuch: Die Liste der Befunde an die Cloud
  // (doorbird.ts syncAuthAlerts) fragt latchLocked mit den Zugangsdaten von jetzt.
  assert.equal(latchLocked(entry, FP), true);
  assert.equal(latchLocked(entry, OTHER), false);
  assert.equal(latchLocked(entry, OTHER, "2026-11-26T08:00:00.000Z"), false);
});

test("Sperre loest sich: Eintrag in der Cloud neu gespeichert (Aenderungszeitpunkt)", () => {
  const rev = "2026-11-26T08:00:00.000Z";
  const { entry } = run([
    { at: NOW, outcome: "abgelehnt", rev },
    { at: NOW + 3_000, outcome: "abgelehnt", rev },
  ]);
  assert.equal(latchGate(entry, FP, NOW + MIN, rev).allow, false);
  const g = latchGate(entry, FP, NOW + MIN, "2026-11-26T09:01:00.000Z");
  assert.equal(g.allow, true);
  assert.equal(g.released, "eintrag");
  assert.equal(g.entry, null);
  // Liefert die Liste keinen Zeitpunkt, zaehlt nur der Fingerabdruck.
  assert.equal(latchGate(entry, FP, NOW + MIN, null).allow, false);
});

test("Eine andere Antwort beendet die Folge, keine Antwort nicht", () => {
  assert.equal(
    run([
      { at: NOW, outcome: "abgelehnt" },
      { at: NOW + 3_000, outcome: "anders" },
      { at: NOW + 6_000, outcome: "abgelehnt" },
    ]).out[2].locked,
    false
  );
  assert.equal(
    run([
      { at: NOW, outcome: "abgelehnt" },
      { at: NOW + 3_000, outcome: "keine" },
      { at: NOW + 6_000, outcome: "abgelehnt" },
    ]).out[2].locked,
    true
  );
});

test("Uhr zurueckgestellt: gesperrt bleibt nicht bis weit in die Zukunft", () => {
  const { entry } = run([
    { at: NOW, outcome: "abgelehnt" },
    { at: NOW + 3_000, outcome: "abgelehnt" },
  ]);
  assert.equal(latchGate(entry, FP, NOW - DAY).allow, true);
});

test("Fingerabdruck: fest, je Zugangsdaten verschieden, ohne die Daten selbst", () => {
  assert.match(FP, /^[0-9a-f]{16}$/);
  assert.equal(FP, credentialFingerprint("192.0.2.30", 80, false, "nutzer", "beispiel"));
  assert.notEqual(FP, OTHER);
  assert.notEqual(FP, credentialFingerprint("192.0.2.31", 80, false, "nutzer", "beispiel"));
  // Grenzen zwischen den Teilen zaehlen mit.
  assert.notEqual(credentialFingerprint("ab", "c"), credentialFingerprint("a", "bc"));
  assert.equal(FP.includes("beispiel"), false);
});

test("Fremde Adresse der Kamerasuche: hoechstens ein Versuch in 24 Stunden, nach einer Ablehnung nie wieder mit denselben Daten", () => {
  assert.equal(probeAllowed(null, FP, NOW), true);
  const tried = probeMarkAfter(null, FP, "keine", NOW);
  assert.equal(probeAllowed(tried, FP, NOW + DAY - 1), false);
  // Je Adresse, gleich mit welchen Zugangsdaten.
  assert.equal(probeAllowed(tried, OTHER, NOW + DAY - 1), false);
  assert.equal(probeAllowed(tried, FP, NOW + DAY), true);
  const rejected = probeMarkAfter(tried, FP, "abgelehnt", NOW + DAY);
  assert.equal(probeAllowed(rejected, FP, NOW + 30 * DAY), false);
  // Andere Zugangsdaten (andere Kamera oder geaendertes Passwort) nach 24 h.
  assert.equal(probeAllowed(rejected, OTHER, NOW + 2 * DAY), true);
  assert.deepEqual(probeMarkAfter(rejected, FP, "abgelehnt", NOW + 2 * DAY).rejected, [FP]);
});

test("Datei: uebersteht das Lesen, enthaelt keine Zugangsdaten, Unlesbares faellt weg", () => {
  const { entry } = run([
    { at: NOW, outcome: "abgelehnt" },
    { at: NOW + 3_000, outcome: "abgelehnt" },
  ]);
  const file = {
    devices: new Map([
      ["doorbird:13", entry!],
      // Eine einzelne Ablehnung, laenger als 7 Tage her: faellt weg.
      ["shelly:192.0.2.40", { fp: OTHER, rejections: 1, lockedAt: 0, lastTryAt: NOW - 8 * DAY, rev: null }],
    ]),
    probes: new Map([
      ["192.0.2.50", probeMarkAfter(null, FP, "abgelehnt", NOW - 40 * DAY)],
      // Ohne Ablehnung und laenger als 24 h her: zaehlt nicht mehr.
      ["192.0.2.51", probeMarkAfter(null, FP, "keine", NOW - DAY)],
      ["192.0.2.52", probeMarkAfter(null, FP, "keine", NOW - MIN)],
    ]),
  };
  const text = serializeLatchFile(file, NOW);
  assert.equal(text.includes("beispiel"), false);
  const back = parseLatchFile(JSON.parse(text), NOW);
  assert.deepEqual([...back.devices.keys()], ["doorbird:13"]);
  assert.equal(latchLocked(back.devices.get("doorbird:13")!, FP), true);
  assert.deepEqual([...back.probes.keys()].sort(), ["192.0.2.50", "192.0.2.52"]);
  assert.equal(probeAllowed(back.probes.get("192.0.2.50")!, FP, NOW), false);

  for (const raw of [null, "x", { version: 2, devices: {} }]) {
    const r = parseLatchFile(raw, NOW);
    assert.equal(r.devices.size + r.probes.size, 0);
  }
  const mixed = parseLatchFile(
    {
      version: 1,
      devices: {
        a: { fp: "kein-hash", rejections: 2, lockedAt: NOW, lastTryAt: NOW },
        b: { ...entry, rejections: -1 },
        c: entry,
      },
      probes: { "192.0.2.60": { lastTryAt: "gestern", rejected: [] } },
    },
    NOW
  );
  assert.deepEqual([...mixed.devices.keys()], ["c"]);
  assert.equal(mixed.probes.size, 0);
});

test("Quelle der Meldung je Hub", () => {
  assert.equal(authAlertSource("Hub Süd 2"), "zugang-hub-sued-2");
  assert.equal(authAlertSource("!!!"), "zugang");
  assert.match(authAlertSource("ein sehr langer Name für einen Hub"), /^[a-z][a-z0-9-]{0,31}$/);
});
