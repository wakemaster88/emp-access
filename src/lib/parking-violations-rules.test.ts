import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COOLDOWN_MINUTES,
  DB_COOLDOWN_MINUTES,
  EVIDENCE_KEY_LOOKBACK_MINUTES,
  EVIDENCE_MAX_AGE_MINUTES,
  EVIDENCE_SENT_SUFFIX,
  cameraUpdateForReport,
  checkEvidenceTarget,
  decideParkingViolation,
  dedupeParkingReport,
  evidenceCaption,
  evidenceSentKey,
  hubDecides,
  nothingDelivered,
  parkingMessage,
  parkingReportReply,
  parseHubParkingParams,
  repeatsFirstImage,
  standingLabel,
} from "./parking-violations-rules";

const MIN = 60_000;
const now = Date.UTC(2026, 10, 6, 11, 0, 0);

const q = (s: string) => new URLSearchParams(s);

test("Angaben des Hubs: ein älterer Hub schickt keine", () => {
  const old = parseHubParkingParams(q("cameraId=9&vehicles=1&seconds=130"));
  assert.deepEqual(old, { notify: null, store: null, inZone: null, reminder: null, storeKey: null, notifyKey: null, evidenceKey: null });
  assert.equal(hubDecides(old), false);

  const first = parseHubParkingParams(q("cameraId=9&vehicles=1&seconds=130&notify=1&store=1&inZone=2"));
  assert.deepEqual(first, { notify: true, store: true, inZone: 2, reminder: null, storeKey: null, notifyKey: null, evidenceKey: null });
  assert.equal(hubDecides(first), true);

  const remind = parseHubParkingParams(q("notify=1&store=0&inZone=1&reminder=2&notifyKey=1764154920000-r2"));
  assert.deepEqual(remind, {
    notify: true,
    store: false,
    inZone: 1,
    reminder: 2,
    storeKey: null,
    notifyKey: "1764154920000-r2",
    evidenceKey: null,
  });
  // Erste Nachricht ohne neuen Eintrag: Schlüssel des gespeicherten (Kennung des Fahrzeugs).
  assert.equal(parseHubParkingParams(q("notify=1&store=0&notifyKey=1764154920000-f&evidenceKey=1764154800000-1")).evidenceKey, "1764154800000-1");

  // Unsinn zählt als nicht angegeben.
  assert.deepEqual(parseHubParkingParams(q("notify=ja&store=&inZone=-1&reminder=0&storeKey=a%20b&notifyKey=&evidenceKey=x%2Be")), {
    notify: null,
    store: null,
    inZone: null,
    reminder: null,
    storeKey: null,
    notifyKey: null,
    evidenceKey: null,
  });
  assert.equal(parseHubParkingParams(q(`storeKey=${"1".repeat(161)}`)).storeKey, null);
  assert.equal(parseHubParkingParams(q("storeKey=1764154800000.1764154860000")).storeKey, "1764154800000.1764154860000");
});

test("Wiederholung mit dem Bild des ersten Versuchs (retry=1): kein neues Kamerabild, „zuletzt gesehen“ schon", () => {
  const at = new Date(now);
  assert.equal(repeatsFirstImage(q("cameraId=9&retry=1")), true);
  assert.equal(repeatsFirstImage(q("cameraId=9")), false, "älterer Hub");
  assert.equal(repeatsFirstImage(q("cameraId=9&retry=ja")), false);
  assert.deepEqual(cameraUpdateForReport("jpeg", at, false), { snapshot: "jpeg", snapshotAt: at, lastSeenAt: at });
  assert.deepEqual(cameraUpdateForReport("jpeg", at, true), { lastSeenAt: at });
});

test("Antwort auf die Meldung: 502 bei nachweislich nichts zugestellt, mit Sichtung und evidence", () => {
  assert.deepEqual(parkingReportReply({ sightingId: 5, pushed: 0, telegram: 0, undelivered: true as const }), {
    status: 502,
    body: { ok: false, error: "Nachricht nicht zugestellt", sightingId: 5, pushed: 0, telegram: 0, undelivered: true, evidence: true },
  });
  assert.deepEqual(parkingReportReply({ sightingId: 5, pushed: 1, telegram: 1 }), {
    status: 200,
    body: { ok: true, sightingId: 5, pushed: 1, telegram: 1, evidence: true },
  });
  // Ohne Sichtung (nur Nachricht) nimmt die Cloud keinen Ausschnitt an.
  assert.deepEqual(parkingReportReply({ sightingId: null, undelivered: true as const }).body.evidence, undefined);
  assert.deepEqual(parkingReportReply({ sightingId: null }), { status: 200, body: { ok: true, sightingId: null } });
});

test("Neuerer Hub: Historie und Nachricht genau wie angegeben, keine Sperre", () => {
  const ctx = { now, lastNotifiedAt: now - MIN, lastSightingAt: now - MIN };
  assert.deepEqual(decideParkingViolation(parseHubParkingParams(q("notify=1&store=1")), ctx), { store: true, notify: true });
  assert.deepEqual(decideParkingViolation(parseHubParkingParams(q("notify=1&store=0&reminder=1")), ctx), { store: false, notify: true });
  assert.deepEqual(decideParkingViolation(parseHubParkingParams(q("notify=0&store=1")), ctx), { store: true, notify: false });
  // Nur eine der beiden Angaben: die andere gilt als 0.
  assert.deepEqual(decideParkingViolation(parseHubParkingParams(q("store=1")), ctx), { store: true, notify: false });
  assert.deepEqual(decideParkingViolation(parseHubParkingParams(q("notify=1")), ctx), { store: false, notify: true });
  assert.deepEqual(decideParkingViolation(parseHubParkingParams(q("notify=0")), ctx), { store: false, notify: false });
});

test("Fehlendes store: älterer Hub immer Historie, neuerer Hub mit store=0 nie", () => {
  const ctx = { now, lastNotifiedAt: null, lastSightingAt: null };
  // Älterer Hub schickt weder store noch notify.
  assert.equal(decideParkingViolation(parseHubParkingParams(q("cameraId=9&vehicles=1&seconds=130")), ctx).store, true);
  // Neuerer Hub, Erinnerung: store=0 heißt keine Sichtung.
  assert.equal(decideParkingViolation(parseHubParkingParams(q("cameraId=9&notify=1&store=0&reminder=1")), ctx).store, false);
  // Unlesbares store bei einem älteren Hub bleibt „nicht angegeben“.
  assert.equal(decideParkingViolation(parseHubParkingParams(q("cameraId=9&store=x")), ctx).store, true);
});

test("Wiederholter Versuch mit demselben Schlüssel: keine zweite Sichtung, keine zweite Nachricht", () => {
  const both = { store: true, notify: true };
  // Erster Versuch: anlegen und schicken.
  assert.deepEqual(dedupeParkingReport(both, { existingSightingId: null, notifySent: false }), {
    createSighting: true,
    sightingId: null,
    notify: true,
  });
  // Antwort ging verloren, der Hub versucht es erneut: vorhandene Sichtung, keine Nachricht.
  assert.deepEqual(dedupeParkingReport(both, { existingSightingId: 41, notifySent: true }), {
    createSighting: false,
    sightingId: 41,
    notify: false,
    skipped: "duplicate",
  });
  // Erster Versuch scheiterte nach der Sichtung, vor der Nachricht: Nachricht jetzt.
  assert.deepEqual(dedupeParkingReport(both, { existingSightingId: 41, notifySent: false }), {
    createSighting: false,
    sightingId: 41,
    notify: true,
  });
  // Erinnerung (store=0) zum zweiten Mal: nichts.
  assert.deepEqual(dedupeParkingReport({ store: false, notify: true }, { existingSightingId: null, notifySent: true }), {
    createSighting: false,
    sightingId: null,
    notify: false,
    skipped: "duplicate",
  });
  // Älterer Hub in der Sperre: bleibt cooldown.
  assert.deepEqual(dedupeParkingReport({ store: true, notify: false, skipped: "cooldown" }, { existingSightingId: null, notifySent: false }), {
    createSighting: true,
    sightingId: null,
    notify: false,
    skipped: "cooldown",
  });
});

test("Älterer Hub: immer Historie, Nachricht höchstens alle 10 Minuten (Speicher) und 9 Minuten (Datenbank)", () => {
  assert.equal(COOLDOWN_MINUTES, 10);
  assert.equal(DB_COOLDOWN_MINUTES, 9);
  const old = parseHubParkingParams(q("cameraId=9"));
  const decide = (lastNotifiedAt: number | null, lastSightingAt: number | null) =>
    decideParkingViolation(old, { now, lastNotifiedAt, lastSightingAt });

  assert.deepEqual(decide(null, null), { store: true, notify: true });
  assert.deepEqual(decide(now - 5 * MIN, null), { store: true, notify: false, skipped: "cooldown" });
  assert.deepEqual(decide(now - 10 * MIN, null), { store: true, notify: true });
  // Andere Server-Instanz ohne Merker: die Datenbank sperrt.
  assert.deepEqual(decide(null, now - 3 * MIN), { store: true, notify: false, skipped: "cooldown" });
  assert.deepEqual(decide(null, now - 9 * MIN), { store: true, notify: true });
  // Älterer Hub meldet alle 10 Minuten: jede Meldung bringt eine Nachricht, wie bisher.
  assert.deepEqual(decide(null, now - 10 * MIN), { store: true, notify: true });
});

test("Text: erste Nachricht wie bisher, Erinnerung nennt Nummer und Zahl der Fahrzeuge", () => {
  assert.deepEqual(parkingMessage({ cameraName: "Einfahrt", vehicles: 1, seconds: 130, time: "12:02", reminder: null }), {
    title: "Falschparker im Halteverbot",
    body: "Einfahrt: Ein Fahrzeug seit 2 Minuten · 12:02",
  });
  assert.deepEqual(parkingMessage({ cameraName: "Einfahrt", vehicles: 2, seconds: 1930, time: "12:32", reminder: 1 }), {
    title: "Falschparker im Halteverbot – 1. Erinnerung",
    body: "Einfahrt: 2 Fahrzeuge stehen noch, seit 32 Minuten · 12:32",
  });
  assert.equal(parkingMessage({ cameraName: "Einfahrt", vehicles: 1, seconds: 7330, time: "14:02", reminder: 3 }).body, "Einfahrt: Ein Fahrzeug steht noch, seit 2 h 2 min · 14:02");
  assert.equal(standingLabel(45), "45 Sekunden");
});

test("Ausschnitt: nur an eine frische Halteverbot-Sichtung ohne Ausschnitt", () => {
  // Auch nach den Wiederholungen des Hubs (rund 30 Minuten), deren erster Versuch die Sichtung anlegte.
  assert.equal(EVIDENCE_MAX_AGE_MINUTES, 60);
  const at = new Date(now);
  const sighting = (o: Partial<{ source: string; seenAt: Date; hasEvidence: boolean }> = {}) => ({
    source: "NO_PARKING",
    seenAt: new Date(now - 5_000),
    hasEvidence: false,
    ...o,
  });
  assert.equal(checkEvidenceTarget(sighting(), at), "ok");
  assert.equal(checkEvidenceTarget(null, at), "not_found");
  assert.equal(checkEvidenceTarget(sighting({ source: "CAMERA_PLATE" }), at), "not_found");
  assert.equal(checkEvidenceTarget(sighting({ hasEvidence: true }), at), "exists");
  assert.equal(checkEvidenceTarget(sighting({ seenAt: new Date(now - 32 * MIN) }), at), "ok");
  assert.equal(checkEvidenceTarget(sighting({ seenAt: new Date(now - 60 * MIN) }), at), "ok");
  assert.equal(checkEvidenceTarget(sighting({ seenAt: new Date(now - 60 * MIN - 1) }), at), "too_old");
});

test("Ausschnitt: Beschriftung in Telegram", () => {
  assert.equal(evidenceCaption("Einfahrt", "12:02"), "Ausschnitt in voller Auflösung · Einfahrt · 12:02");
  assert.equal(evidenceCaption(null, "12:02"), "Ausschnitt in voller Auflösung · 12:02");
});

test("Marke für den Ausschnitt zur ersten Nachricht: kein Schlüssel vom Hub sieht so aus", () => {
  assert.equal(EVIDENCE_SENT_SUFFIX, "+e");
  assert.equal(evidenceSentKey("1764154920000-f"), "1764154920000-f+e");
  // Ein Hub-Schlüssel mit „+“ wird nicht angenommen, die Marke kann also keiner sein.
  assert.equal(parseHubParkingParams(q(`notifyKey=${encodeURIComponent(evidenceSentKey("1764154920000-f"))}`)).notifyKey, null);
  // Gespeichert nachts, gemeldet morgens: Der Eintrag wird einen Tag zurück gesucht.
  assert.equal(EVIDENCE_KEY_LOOKBACK_MINUTES, 24 * 60);
});

test("Schlüssel freigeben nur, wenn nachweislich nichts hinausging", () => {
  const base = { channels: 2, pushSent: 0, pushUncertain: false, telegramSent: 0, telegramUncertain: false };
  // Push-Bibliothek nicht ladbar, Telegram lehnt ab: nichts verschickt.
  assert.equal(nothingDelivered(base), true);
  assert.equal(nothingDelivered({ ...base, pushSent: 1 }), false);
  assert.equal(nothingDelivered({ ...base, telegramSent: 1 }), false);
  // Zeitüberschreitung: Ob es ankam, ist offen – der Schlüssel bleibt beansprucht.
  assert.equal(nothingDelivered({ ...base, pushUncertain: true }), false);
  assert.equal(nothingDelivered({ ...base, telegramUncertain: true }), false);
  // Niemand zu benachrichtigen: kein Fehler, nichts zu wiederholen.
  assert.equal(nothingDelivered({ ...base, channels: 0 }), false);
});
