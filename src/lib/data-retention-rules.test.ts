import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DATA_RETENTION,
  RETENTION_KEYS,
  RETENTION_LABELS,
  parseDataRetention,
  retentionNullLabel,
  type DataRetentionConfig,
} from "./data-retention-config";
import {
  RETENTION_BATCH,
  RETENTION_MAX_ROWS,
  nextBatchSize,
  personSightingsWhere,
  retentionCutoffs,
  retentionRestLine,
  scanSnapshotBlobsWhere,
  scanSnapshotsWhere,
  scansWhere,
  unknownSightingsWhere,
} from "./data-retention-rules";

const DAY = 24 * 60 * 60 * 1000;
/** Nacht-Lauf des Crons (01:30 UTC). */
const NOW = new Date("2026-11-26T01:30:00.000Z");

/** Gespeicherte Fristen eines Kontos vor den Teil-Fristen: alle bisherigen Schlüssel, die neuen fehlen. */
const STORED_BEFORE = {
  vehicleSightings: 30,
  personSightings: 30,
  cameraEvents: 14,
  scans: 365,
  irrigationRuns: 365,
  automationRuns: 90,
  emailSends: 180,
  hubTasks: 14,
  discoveredDevices: 60,
  audioJobs: 30,
  monitorAlerts: 30,
};

const BASE_KEYS = Object.keys(STORED_BEFORE) as Array<keyof typeof STORED_BEFORE>;

/** Lösch-Bedingungen des bisherigen Laufs: je Schlüssel mit Frist ein Stichtag `now - Tage`. */
function baselineCutoffs(stored: Record<string, number | null>, now: Date) {
  const out: Record<string, Date> = {};
  for (const key of BASE_KEYS) {
    const days = stored[key];
    if (days != null) out[key] = new Date(now.getTime() - days * DAY);
  }
  return out;
}

test("ohne die neuen Schlüssel: Grenzen exakt wie im bisherigen Lauf, kein neuer Schritt", () => {
  const config = parseDataRetention(STORED_BEFORE);
  assert.equal(config.personSightingsUnknown, null);
  assert.equal(config.scanSnapshots, null);
  const cutoffs = retentionCutoffs(config, NOW);
  assert.deepEqual(cutoffs, baselineCutoffs(STORED_BEFORE, NOW));
  assert.equal("personSightingsUnknown" in cutoffs, false);
  assert.equal("scanSnapshots" in cutoffs, false);
});

test("nie gespeichert (Standard) und ausdrücklich null: ebenfalls exakt wie bisher", () => {
  const fromDefault = retentionCutoffs(parseDataRetention(null), NOW);
  assert.deepEqual(fromDefault, baselineCutoffs(STORED_BEFORE, NOW));
  const explicitNull = retentionCutoffs(
    parseDataRetention({ ...STORED_BEFORE, personSightingsUnknown: null, scanSnapshots: null }),
    NOW
  );
  assert.deepEqual(explicitNull, baselineCutoffs(STORED_BEFORE, NOW));
  // Ungültige Werte gelten wie fehlende (Standard null).
  const invalid = retentionCutoffs(
    parseDataRetention({ ...STORED_BEFORE, personSightingsUnknown: 0, scanSnapshots: "7" }),
    NOW
  );
  assert.deepEqual(invalid, baselineCutoffs(STORED_BEFORE, NOW));
});

test("Bedingungen der bisherigen Schritte unverändert", () => {
  const cutoff = new Date(NOW.getTime() - 30 * DAY);
  assert.deepEqual(personSightingsWhere(1, cutoff), { accountId: 1, seenAt: { lt: cutoff } });
  assert.deepEqual(scansWhere(1, cutoff), { accountId: 1, scanTime: { lt: cutoff } });
  assert.deepEqual(scanSnapshotBlobsWhere(1, cutoff), {
    accountId: 1,
    blobPathname: { not: null },
    scan: { scanTime: { lt: cutoff } },
  });
});

test("Standard der Teil-Fristen ist null, die übrigen Standards bleiben", () => {
  assert.equal(DEFAULT_DATA_RETENTION.personSightingsUnknown, null);
  assert.equal(DEFAULT_DATA_RETENTION.scanSnapshots, null);
  for (const key of BASE_KEYS) assert.equal(DEFAULT_DATA_RETENTION[key], STORED_BEFORE[key], key);
  assert.deepEqual(
    RETENTION_KEYS.filter((k) => !BASE_KEYS.includes(k as (typeof BASE_KEYS)[number])),
    ["personSightingsUnknown", "scanSnapshots"]
  );
});

test("gesetzte Teil-Fristen: eigener Schritt mit eigenem Stichtag, übergeordneter bleibt", () => {
  const config = parseDataRetention({ ...STORED_BEFORE, personSightingsUnknown: 7, scanSnapshots: 90 });
  const cutoffs = retentionCutoffs(config, NOW);
  assert.deepEqual(cutoffs.personSightingsUnknown, new Date("2026-11-19T01:30:00.000Z"));
  assert.deepEqual(cutoffs.scanSnapshots, new Date("2026-08-28T01:30:00.000Z"));
  assert.deepEqual(cutoffs.personSightings, new Date("2026-10-27T01:30:00.000Z"));
  assert.deepEqual(cutoffs.scans, new Date("2025-11-26T01:30:00.000Z"));
});

test("Bedingungen der Teil-Fristen: nur ohne Person bzw. nur das Foto", () => {
  const cutoff = new Date("2026-11-19T01:30:00.000Z");
  assert.deepEqual(unknownSightingsWhere(1, cutoff), { accountId: 1, listedPersonId: null, seenAt: { lt: cutoff } });
  assert.deepEqual(scanSnapshotsWhere(1, cutoff), { accountId: 1, capturedAt: { lt: cutoff } });
});

test("eine Teil-Frist gleich oder länger als die übergeordnete verlängert nichts und läuft nicht", () => {
  const base: DataRetentionConfig = parseDataRetention(STORED_BEFORE);
  for (const [unknown, snaps] of [
    [30, 365],
    [60, 3650],
  ]) {
    const cutoffs = retentionCutoffs({ ...base, personSightingsUnknown: unknown, scanSnapshots: snaps }, NOW);
    assert.deepEqual(cutoffs, baselineCutoffs(STORED_BEFORE, NOW), `${unknown}/${snaps}`);
  }
});

test("übergeordnete Frist unbegrenzt: Teil-Frist läuft allein", () => {
  const config = { ...parseDataRetention(STORED_BEFORE), personSightings: null, scans: null, personSightingsUnknown: 7, scanSnapshots: 90 };
  const cutoffs = retentionCutoffs(config, NOW);
  assert.equal(cutoffs.personSightings, undefined);
  assert.equal(cutoffs.scans, undefined);
  assert.ok(cutoffs.personSightingsUnknown);
  assert.ok(cutoffs.scanSnapshots);
});

test("Stichtag über Monats-, Jahres- und Schaltjahresgrenze", () => {
  const config = (unknown: number, snaps: number) =>
    ({ ...parseDataRetention(STORED_BEFORE), personSightingsUnknown: unknown, scanSnapshots: snaps }) as DataRetentionConfig;
  // Monatsgrenze: 1. März 2027 minus 7 Tage = 22. Februar.
  const march = retentionCutoffs(config(7, 90), new Date("2027-03-01T01:30:00.000Z"));
  assert.equal(march.personSightingsUnknown?.toISOString(), "2027-02-22T01:30:00.000Z");
  assert.equal(march.scanSnapshots?.toISOString(), "2026-12-01T01:30:00.000Z");
  // Jahresgrenze.
  const january = retentionCutoffs(config(7, 90), new Date("2027-01-03T01:30:00.000Z"));
  assert.equal(january.personSightingsUnknown?.toISOString(), "2026-12-27T01:30:00.000Z");
  assert.equal(january.scanSnapshots?.toISOString(), "2026-10-05T01:30:00.000Z");
  // Schaltjahr: 1. März 2028 minus 7 Tage = 23. Februar (der 29. zählt mit).
  const leap = retentionCutoffs(config(7, 90), new Date("2028-03-01T01:30:00.000Z"));
  assert.equal(leap.personSightingsUnknown?.toISOString(), "2028-02-23T01:30:00.000Z");
  assert.equal(leap.scanSnapshots?.toISOString(), "2027-12-02T01:30:00.000Z");
  // Zeitumstellung spielt keine Rolle: gerechnet wird in UTC mit vollen 24 Stunden.
  const dst = retentionCutoffs(config(7, 90), new Date("2026-04-01T01:30:00.000Z"));
  assert.equal(dst.personSightingsUnknown?.toISOString(), "2026-03-25T01:30:00.000Z");
});

test("Portionen: je 500, höchstens bis zur Obergrenze je Lauf, nur im Zeitbudget", () => {
  const t = 1_000_000;
  assert.equal(RETENTION_BATCH, 500);
  assert.equal(nextBatchSize({ deleted: 0, nowMs: t, untilMs: t + 1 }), RETENTION_BATCH);
  assert.equal(nextBatchSize({ deleted: RETENTION_MAX_ROWS - 200, nowMs: t, untilMs: t + 1 }), 200);
  assert.equal(nextBatchSize({ deleted: RETENTION_MAX_ROWS, nowMs: t, untilMs: t + 1 }), 0);
  assert.equal(nextBatchSize({ deleted: RETENTION_MAX_ROWS + 5, nowMs: t, untilMs: t + 1 }), 0);
  assert.equal(nextBatchSize({ deleted: 0, nowMs: t, untilMs: t }), 0);
  assert.equal(nextBatchSize({ deleted: 0, nowMs: t, untilMs: Number.NaN }), 0);
  assert.equal(nextBatchSize({ deleted: 0, nowMs: t, untilMs: t + 1, batch: 100, maxRows: 150 }), 100);
  assert.equal(nextBatchSize({ deleted: 100, nowMs: t, untilMs: t + 1, batch: 100, maxRows: 150 }), 50);
});

test("Portionen: ein erster Lauf mit mehreren tausend Zeilen braucht mehrere Läufe", () => {
  // Simulation der Schleife in data-retention.ts mit 7.812 fälligen Zeilen.
  let due = 7_812;
  let runs = 0;
  while (due > 0) {
    runs++;
    let deleted = 0;
    let statements = 0;
    for (;;) {
      const take = nextBatchSize({ deleted, nowMs: 0, untilMs: 1 });
      if (take === 0) break;
      const rows = Math.min(take, due);
      if (rows === 0) break;
      due -= rows;
      deleted += rows;
      statements++;
      assert.ok(rows <= RETENTION_BATCH);
      if (rows < take) break;
    }
    assert.ok(deleted <= RETENTION_MAX_ROWS);
    assert.ok(statements <= Math.ceil(RETENTION_MAX_ROWS / RETENTION_BATCH));
  }
  assert.equal(runs, Math.ceil(7_812 / RETENTION_MAX_ROWS));
});

test("Log-Zeile nennt Rest und Konto, keine Namen", () => {
  assert.equal(
    retentionRestLine(1, "scanSnapshots", 2000, 5812),
    "[retention] account=1 scanSnapshots: 2000 gelöscht, 5812 übrig (Obergrenze bzw. Zeitbudget des Laufs) – der nächste Lauf macht weiter"
  );
});

test("Beschriftung: Teil-Fristen „Wie …“ statt „Unbegrenzt“", () => {
  assert.equal(retentionNullLabel("personSightingsUnknown"), "Wie „Personen“");
  assert.equal(retentionNullLabel("scanSnapshots"), "Wie „Scans“");
  assert.equal(retentionNullLabel("personSightings"), "Unbegrenzt");
  for (const key of RETENTION_KEYS) assert.ok(RETENTION_LABELS[key].label && RETENTION_LABELS[key].description, key);
});
