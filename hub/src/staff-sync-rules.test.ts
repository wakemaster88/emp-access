import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAFF_FETCH_TIMEOUT_MS,
  STAFF_STALE_MS,
  STAFF_SYNC_INTERVAL_MS,
  STAFF_SYNC_NIGHT_MS,
  STAFF_SYNC_RETRY_MS,
  staffStaleAfterMs,
  staffSyncDelayMs,
  staffSyncNight,
  staffSyncWaitMs,
} from "./staff-sync-rules.js";

const nobody = { clockedIn: 0, failed: false };
const at = (iso: string) => new Date(iso);

test("Personal-Abgleich: tagsüber jede Minute, nachts alle 4 Minuten (Winterzeit)", () => {
  assert.equal(staffSyncDelayMs(at("2026-11-26T11:00:00Z"), nobody), 60_000); // 12:00 Ortszeit
  assert.equal(staffSyncDelayMs(at("2026-11-26T02:00:00Z"), nobody), 240_000); // 03:00
  assert.equal(staffSyncDelayMs(at("2026-11-26T21:59:00Z"), nobody), 60_000); // 22:59
  assert.equal(staffSyncDelayMs(at("2026-11-26T22:00:00Z"), nobody), 240_000); // 23:00
  assert.equal(staffSyncDelayMs(at("2026-11-27T04:59:00Z"), nobody), 240_000); // 05:59
  assert.equal(staffSyncDelayMs(at("2026-11-27T05:00:00Z"), nobody), 60_000); // 06:00
});

test("Personal-Abgleich: Sommerzeit nach Ortszeit, nicht nach UTC", () => {
  assert.equal(staffSyncDelayMs(at("2026-07-01T20:59:00Z"), nobody), 60_000); // 22:59
  assert.equal(staffSyncDelayMs(at("2026-07-01T21:00:00Z"), nobody), 240_000); // 23:00
  assert.equal(staffSyncDelayMs(at("2026-07-02T03:59:00Z"), nobody), 240_000); // 05:59
  assert.equal(staffSyncDelayMs(at("2026-07-02T04:00:00Z"), nobody), 60_000); // 06:00
});

test("Personal-Abgleich: nachts jede Minute, solange jemand eingestempelt ist oder der Abruf scheiterte", () => {
  const night = at("2026-11-26T02:00:00Z");
  assert.equal(staffSyncDelayMs(night, { clockedIn: 1, failed: false }), 60_000);
  assert.equal(staffSyncDelayMs(night, { clockedIn: 0, failed: true }), 60_000);
  assert.equal(staffSyncDelayMs(night, { clockedIn: Number.NaN, failed: false }), 60_000);
  assert.equal(staffSyncDelayMs(night, { clockedIn: -1, failed: false }), 60_000);
});

test("Personal-Abgleich: Ortszeit nicht lesbar → Takt des Tages", () => {
  assert.equal(staffSyncDelayMs(new Date(Number.NaN), nobody), STAFF_SYNC_INTERVAL_MS);
  assert.equal(staffSyncNight(Number.NaN), false);
  assert.equal(staffSyncNight(23), true);
  assert.equal(staffSyncNight(5), true);
  assert.equal(staffSyncNight(6), false);
  assert.equal(staffSyncNight(22), false);
});

test("Personal-Abgleich: die Übersicht wird nie veraltet, solange die Abrufe klappen", () => {
  // Der nächste Abruf startet höchstens `delay` nach dem Start des letzten
  // und endet spätestens nach dem Zeitlimit; der Stand ist nie älter als
  // beides zusammen. Geprüft über zwei Tage im Minutenabstand, darunter die
  // Nacht der Umstellung auf Winterzeit.
  let max = 0;
  for (const start of ["2026-10-24T00:00:00Z", "2026-11-26T00:00:00Z"]) {
    for (let m = 0; m < 48 * 60; m++) {
      const now = new Date(Date.parse(start) + m * 60_000);
      max = Math.max(max, staffSyncDelayMs(now, nobody), staffSyncDelayMs(now, { clockedIn: 3, failed: false }));
    }
  }
  assert.equal(max, STAFF_SYNC_NIGHT_MS);
  assert.ok(max + STAFF_FETCH_TIMEOUT_MS < STAFF_STALE_MS, `${max} + ${STAFF_FETCH_TIMEOUT_MS} < ${STAFF_STALE_MS}`);
  // Auch mit dem Zeitlimit des vorigen Abrufs (falls die Cloud den Stand früh im Aufruf stempelt) noch darunter.
  assert.ok(max + 2 * STAFF_FETCH_TIMEOUT_MS < STAFF_STALE_MS);
  // Die Grenze selbst bleibt bei 5 Minuten.
  assert.equal(STAFF_STALE_MS, 5 * 60_000);
});

test("Personal-Abgleich: 1.125 statt 1.440 Abrufe pro Tag, wenn nachts niemand eingestempelt ist", () => {
  let calls = 0;
  const dayStart = Date.parse("2026-11-26T00:00:00+01:00");
  for (let t = dayStart; t < dayStart + 24 * 3600_000; ) {
    calls++;
    t += staffSyncDelayMs(new Date(t), nobody);
  }
  // 17 Stunden je 60 Abrufe, 7 Stunden je 15.
  assert.equal(calls, 17 * 60 + 7 * 15);
});

test("Personal-Abgleich: Wartezeit nie laenger als der Abstand, auch wenn eine Uhr zurueckspringt", () => {
  // Abruf begann bei 1.000 s und dauerte 5 s: noch 55 s bzw. 235 s.
  assert.equal(staffSyncWaitMs(1_000_000, 1_005_000, 60_000), 55_000);
  assert.equal(staffSyncWaitMs(1_000_000, 1_005_000, 240_000), 235_000);
  // Abruf dauerte laenger als der Abstand: sofort.
  assert.equal(staffSyncWaitMs(1_000_000, 1_080_000, 60_000), 0);
  // Uhr waehrend des Abrufs 30 min zurueck: hoechstens ein Abstand, nicht 31 min.
  assert.equal(staffSyncWaitMs(1_000_000, 1_005_000 - 30 * 60_000, 60_000), 60_000);
  assert.equal(staffSyncWaitMs(1_000_000, 1_005_000 - 30 * 60_000, 240_000), 240_000);
  // Unbrauchbare Zeit: ein Abstand.
  assert.equal(staffSyncWaitMs(Number.NaN, 1_005_000, 60_000), 60_000);
  assert.equal(staffSyncWaitMs(1_000_000, Number.NaN, 240_000), 240_000);
});

test("Personal-Abgleich: nachts nach einem Fehlschlag nach 15 s ein neuer Versuch, solange der Stand frisch ist", () => {
  const night = at("2026-11-26T02:00:00Z");
  const failedAfter = (sinceOkMs: number | null) => staffSyncDelayMs(night, { clockedIn: 0, failed: true, sinceOkMs });
  assert.equal(STAFF_SYNC_RETRY_MS, 15_000);
  assert.equal(failedAfter(240_100), STAFF_SYNC_RETRY_MS);
  assert.equal(failedAfter(299_999), STAFF_SYNC_RETRY_MS);
  // Stand schon veraltet oder seit dem Start kein guter Abruf: jede Minute wie bisher.
  assert.equal(failedAfter(300_000), 60_000);
  assert.equal(failedAfter(3_600_000), 60_000);
  assert.equal(failedAfter(null), 60_000);
  assert.equal(failedAfter(Number.NaN), 60_000);
  assert.equal(failedAfter(-1), 60_000);
  // Tagsueber und mit Eingestempelten: jede Minute wie bisher.
  assert.equal(staffSyncDelayMs(at("2026-11-26T11:00:00Z"), { clockedIn: 0, failed: true, sinceOkMs: 60_100 }), 60_000);
  assert.equal(staffSyncDelayMs(night, { clockedIn: 2, failed: true, sinceOkMs: 60_100 }), 60_000);
  // Ein guter Abruf: weiter alle 4 Minuten.
  assert.equal(staffSyncDelayMs(night, { clockedIn: 0, failed: false, sinceOkMs: 100 }), STAFF_SYNC_NIGHT_MS);
});

/**
 * Nachts (niemand eingestempelt) eine Folge von Abrufen nachspielen, Takt wie
 * in staff.ts. `runs`: Ergebnis und Dauer je Abruf. Das Alter des Stands
 * zaehlt ab dem Start des letzten guten Abrufs (aelter stempelt ihn die
 * Cloud nicht). Ergebnis: hoechstes Alter bis zum Ende des letzten Abrufs
 * und die Startzeiten.
 */
function playNight(runs: Array<{ ok: boolean; ms: number }>) {
  const t0 = Date.parse("2026-11-26T01:00:00Z"); // 02:00 Ortszeit
  let start = 0;
  let lastOk: number | null = null;
  let okDelay: number | null = null;
  let maxAge = 0;
  const starts: number[] = [];
  for (const r of runs) {
    starts.push(start);
    const end = start + r.ms;
    if (lastOk !== null) maxAge = Math.max(maxAge, end - lastOk);
    if (r.ok) lastOk = start;
    const delay = staffSyncDelayMs(new Date(t0 + end), {
      clockedIn: 0,
      failed: !r.ok,
      sinceOkMs: lastOk === null ? null : end - lastOk,
      staleAfterMs: staffStaleAfterMs(okDelay),
    });
    if (r.ok) okDelay = delay;
    start = end + staffSyncWaitMs(start, end, delay);
  }
  return { maxAge, starts };
}

/**
 * Ausfall der Cloud von `downMs` ab `fromMs` nachspielen (jeder Abruf, der
 * darin startet, scheitert nach 100 ms), nachts, niemand eingestempelt.
 * "neu": Takt und Grenze wie in staff.ts. "minute": der fruehere Takt, jede
 * Minute mit der festen Grenze STAFF_STALE_MS. Ergebnis: Sekunden, in denen
 * die Uebersicht als veraltet gilt, und der erste davon.
 */
function outage(fromMs: number, downMs: number, mode: "neu" | "minute", horizonMs = 1_800_000) {
  const t0 = Date.parse("2026-11-26T01:00:00Z"); // 02:00 Ortszeit
  const fetches: Array<{ start: number; end: number; ok: boolean; okDelay: number | null }> = [];
  let start = 0;
  let lastOk: number | null = null;
  let okDelay: number | null = null;
  while (start < horizonMs) {
    const ok = !(start >= fromMs && start < fromMs + downMs);
    const end = start + 100;
    if (ok) lastOk = start;
    if (mode === "minute") {
      fetches.push({ start, end, ok, okDelay: null });
      start += STAFF_SYNC_INTERVAL_MS;
      continue;
    }
    const delay = staffSyncDelayMs(new Date(t0 + end), {
      clockedIn: 0,
      failed: !ok,
      sinceOkMs: lastOk === null ? null : end - lastOk,
      staleAfterMs: staffStaleAfterMs(okDelay),
    });
    if (ok) okDelay = delay;
    fetches.push({ start, end, ok, okDelay });
    start = end + staffSyncWaitMs(start, end, delay);
  }
  let staleS = 0;
  let firstStale: number | null = null;
  let i = 0;
  let curOk: number | null = null;
  let curDelay: number | null = null;
  for (let t = 0; t < horizonMs; t += 1000) {
    while (i < fetches.length && fetches[i].end <= t) {
      if (fetches[i].ok) {
        curOk = fetches[i].start;
        curDelay = fetches[i].okDelay;
      }
      i++;
    }
    if (curOk === null) continue;
    const limit = mode === "minute" ? STAFF_STALE_MS : staffStaleAfterMs(curDelay);
    if (t - curOk > limit) {
      staleS++;
      firstStale ??= t;
    }
  }
  return { staleS, firstStale };
}

test("Personal-Abgleich: Grenze zum Veralten waechst mit dem Nacht-Takt", () => {
  assert.equal(staffStaleAfterMs(null), STAFF_STALE_MS);
  assert.equal(staffStaleAfterMs(undefined), STAFF_STALE_MS);
  assert.equal(staffStaleAfterMs(Number.NaN), STAFF_STALE_MS);
  assert.equal(staffStaleAfterMs(STAFF_SYNC_INTERVAL_MS), STAFF_STALE_MS);
  assert.equal(staffStaleAfterMs(STAFF_SYNC_RETRY_MS), STAFF_STALE_MS);
  assert.equal(staffStaleAfterMs(STAFF_SYNC_NIGHT_MS), 8 * 60_000);
  assert.equal(staffStaleAfterMs(10 * STAFF_SYNC_NIGHT_MS), 8 * 60_000);
});

test("Personal-Abgleich: ein kurzer Ausfall nachts macht die Uebersicht nicht oefter veraltet als im Minuten-Takt", () => {
  for (const down of [75_000, 120_000, 180_000, 239_000]) {
    for (let from = 1000; from < 240_000; from += 1000) {
      const neu = outage(from, down, "neu");
      const minute = outage(from, down, "minute");
      assert.equal(minute.staleS, 0, `Minuten-Takt, Ausfall ${down} ms ab ${from} ms`);
      assert.equal(neu.staleS, 0, `Ausfall ${down} ms ab ${from} ms: ${neu.staleS} s veraltet`);
    }
  }
});

test("Personal-Abgleich: ein langer Ausfall nachts macht die Uebersicht nie frueher veraltet als im Minuten-Takt", () => {
  // Der Ausfall beginnt nach dem ersten guten Abruf (bei 0 ms).
  for (let from = 1000; from < 240_000; from += 1000) {
    const neu = outage(from, 3_600_000, "neu");
    const minute = outage(from, 3_600_000, "minute");
    assert.ok(minute.firstStale !== null && neu.firstStale !== null);
    assert.ok(neu.firstStale >= minute.firstStale, `ab ${from} ms: ${neu.firstStale} < ${minute.firstStale}`);
  }
});

test("Personal-Abgleich: nachts veraltet die Uebersicht auch nach ein oder zwei Fehlschlaegen nicht", () => {
  const fast = 100;
  const timeout = STAFF_FETCH_TIMEOUT_MS;
  const ok = (ms: number) => ({ ok: true, ms });
  const fail = (ms: number) => ({ ok: false, ms });
  for (const first of [fast, timeout - 100]) {
    for (const last of [fast, timeout - 100]) {
      assert.ok(playNight([ok(first), ok(last)]).maxAge < STAFF_STALE_MS);
      for (const f1 of [fast, timeout]) {
        const one = playNight([ok(first), fail(f1), ok(last)]);
        assert.ok(one.maxAge < STAFF_STALE_MS, `ein Fehlschlag (${f1} ms): ${one.maxAge}`);
        for (const f2 of [fast, timeout]) {
          const two = playNight([ok(first), fail(f1), fail(f2), ok(last)]);
          assert.ok(two.maxAge < STAFF_STALE_MS, `zwei Fehlschlaege (${f1}, ${f2} ms): ${two.maxAge}`);
        }
      }
    }
  }
  // Schnelle Fehlschlaege (HTTP 502): auch drei haben noch Platz.
  const three = playNight([ok(fast), fail(fast), fail(fast), fail(fast), ok(fast)]);
  assert.deepEqual(three.starts, [0, 240_000, 255_000, 270_000, 285_000]);
  assert.ok(three.maxAge < STAFF_STALE_MS);
});

test("Personal-Abgleich: faellt die Cloud nachts eine Stunde aus, kommen nur die ersten Versuche schneller", () => {
  const runs = [{ ok: true, ms: 100 }];
  for (let i = 0; i < 200; i++) runs.push({ ok: false, ms: 100 });
  const { starts } = playNight(runs);
  const inHour = starts.filter((t) => t > 0 && t <= 3_600_000);
  // Bis zum Veralten (nach dem Nacht-Takt 480 s) alle 15 s, danach jede Minute:
  // 60 im Minutentakt des Tages, hier neun mehr.
  const fast = Array.from({ length: 17 }, (_, i) => 240_000 + i * STAFF_SYNC_RETRY_MS);
  assert.deepEqual(inHour.slice(0, 19), [...fast, 540_000, 600_000]);
  assert.ok(inHour.length <= 69, `${inHour.length} Versuche`);
});
