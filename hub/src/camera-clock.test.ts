import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLOCK_DAY_MS,
  CLOCK_TARGET_BERLIN,
  berlinWall,
  classifyClockOffset,
  clockOffsetSeconds,
  clockPlan,
  clockPlanAffected,
  clockPlanDue,
  clockPlanKeyAfter,
  clockPlanLine,
  clockSettingsDue,
  isSiteAddress,
  parseClockMemo,
  parseClockSettings,
  serializeClockMemo,
  type ClockMemo,
  type ClockSettings,
} from "./camera-clock.js";

test("Berliner Wanduhr im Winter (UTC+1)", () => {
  assert.deepEqual(berlinWall(new Date("2026-11-05T13:00:00Z")), { year: 2026, mon: 11, day: 5, hour: 14, min: 0, sec: 0 });
});

test("Kamera geht 42 s vor", () => {
  const now = new Date("2026-11-05T13:00:00Z");
  assert.equal(clockOffsetSeconds({ year: 2026, mon: 11, day: 5, hour: 14, min: 0, sec: 42 }, now), 42);
});

test("falsche Sommerzeit fällt als -3600 s auf", () => {
  const now = new Date("2026-11-05T13:00:00Z");
  assert.equal(clockOffsetSeconds({ year: 2026, mon: 11, day: 5, hour: 13, min: 0, sec: 0 }, now), -3600);
});

test("classifyClockOffset: ganze Stunden mit Rest unter 120 s sind Zeitzone, sonst Drift oder im Takt", () => {
  assert.deepEqual(classifyClockOffset(0), { kind: "ok", hours: 0, restS: 0 });
  assert.deepEqual(classifyClockOffset(-2), { kind: "ok", hours: 0, restS: -2 });
  assert.deepEqual(classifyClockOffset(3), { kind: "drift", hours: 0, restS: 3 });
  assert.deepEqual(classifyClockOffset(-45), { kind: "drift", hours: 0, restS: -45 });
  assert.deepEqual(classifyClockOffset(3600), { kind: "zeitzone", hours: 1, restS: 0 });
  assert.deepEqual(classifyClockOffset(-3600 + 7), { kind: "zeitzone", hours: -1, restS: 7 });
  assert.deepEqual(classifyClockOffset(7200 + 119), { kind: "zeitzone", hours: 2, restS: 119 });
  assert.deepEqual(classifyClockOffset(3600 + 120), { kind: "drift", hours: 1, restS: 120 });
  assert.deepEqual(classifyClockOffset(-3600 - 300), { kind: "drift", hours: -1, restS: -300 });
  // Eine halbe Stunde ist keine Zeitzone hier.
  assert.equal(classifyClockOffset(1800).kind, "drift");
});

/** GetTime wie von einer Reolink-Kamera (Berlin, Sommerzeit nach EU-Regel). */
const getTime = (o: { timeZone?: number; dst?: Record<string, number> | null } = {}) => ({
  Time: { year: 2026, mon: 11, day: 26, hour: 10, min: 0, sec: 0, timeZone: o.timeZone ?? -3600, timeFmt: "DD/MM/YYYY", hourFmt: 0 },
  ...(o.dst === null
    ? {}
    : {
        Dst: {
          enable: 1,
          offset: 1,
          startMon: 3,
          startWeek: 5,
          startWeekday: 0,
          startHour: 2,
          startMin: 0,
          startSec: 0,
          endMon: 10,
          endWeek: 5,
          endWeekday: 0,
          endHour: 3,
          endMin: 0,
          endSec: 0,
          ...o.dst,
        },
      }),
});
const getNtp = (enable: number, server: string) => ({ Ntp: { enable, server, port: 123, interval: 1440 } });

test("parseClockSettings: Zeitzone mit umgekehrtem Vorzeichen, Sommerzeit, Zeitserver", () => {
  assert.deepEqual(parseClockSettings(getTime(), getNtp(1, "192.168.1.1")), {
    utcOffsetS: 3600,
    dst: { enabled: true, offsetH: 1, startMon: 3, startWeek: 5, startWeekday: 0, endMon: 10, endWeek: 5, endWeekday: 0 },
    ntp: true,
    ntpServer: "192.168.1.1",
  });
  const none = parseClockSettings({ Time: { year: 2026 } }, null);
  assert.deepEqual(none, { utcOffsetS: null, dst: null, ntp: null, ntpServer: null });
  assert.equal(parseClockSettings(getTime({ timeZone: 0 }), null).utcOffsetS, 0);
  assert.equal(parseClockSettings(getTime(), getNtp(0, "")).ntp, false);
  assert.equal(parseClockSettings(getTime(), getNtp(0, "")).ntpServer, null);
  assert.deepEqual(parseClockSettings(null, "kaputt"), { utcOffsetS: null, dst: null, ntp: null, ntpServer: null });
});

test("isSiteAddress: private Adressen und lokale Namen, alles andere nicht", () => {
  for (const a of ["192.168.1.1", "10.0.0.2", "172.16.0.1", "172.31.255.254", "zeit.local", "router.lan", "fritz.box", "box.fritz.box"]) {
    assert.equal(isSiteAddress(a), true, a);
  }
  for (const a of ["pool.ntp.org", "8.8.8.8", "172.32.0.1", "192.169.0.1", "999.168.1.1", "local", "notfritz.box", "", null, undefined]) {
    assert.equal(isSiteAddress(a), false, String(a));
  }
});

const settingsOf = (t = getTime(), n: unknown = getNtp(1, "192.168.1.1")): ClockSettings => parseClockSettings(t, n);

test("clockPlan: alles wie gewollt – nichts umzustellen", () => {
  const plan = clockPlan({ offsetS: 1, settings: settingsOf() }, CLOCK_TARGET_BERLIN);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.kind, "ok");
  assert.equal(
    clockPlanLine("Eingang", 1, plan),
    "Kamera-Uhr Eingang: im Takt; Zeitzone UTC+1, Sommerzeit an (EU-Regel), Zeitserver an (im Standort-Netz 192.168.1.1) – nichts umzustellen"
  );
});

test("clockPlan: falsche Zeitzone und Sommerzeit aus", () => {
  const plan = clockPlan(
    { offsetS: -3600, settings: settingsOf(getTime({ timeZone: 0, dst: { enable: 0 } }), getNtp(0, "")) },
    CLOCK_TARGET_BERLIN
  );
  assert.equal(plan.kind, "zeitzone");
  assert.deepEqual(plan.steps, ["Zeitzone UTC+1 statt UTC+0", "Sommerzeit einschalten (EU-Regel)", "Zeitserver einschalten"]);
  assert.equal(
    clockPlanLine("Hof", -3600, plan),
    "Kamera-Uhr Hof: -3600 s (Zeitzone); Zeitzone UTC+0, Sommerzeit aus, Zeitserver aus – Vorschlag: Zeitzone UTC+1 statt UTC+0, Sommerzeit einschalten (EU-Regel), Zeitserver einschalten (nicht umgestellt)"
  );
});

test("clockPlan: andere Sommerzeit-Regel, Stunde ohne erkennbaren Grund, Drift", () => {
  const us = clockPlan({ offsetS: 0, settings: settingsOf(getTime({ dst: { startMon: 3, startWeek: 2, endMon: 11, endWeek: 1 } })) }, CLOCK_TARGET_BERLIN);
  assert.deepEqual(us.steps, ["Sommerzeit-Regel auf EU (letzter Sonntag im März bis letzter Sonntag im Oktober)"]);
  assert.match(us.state, /Sommerzeit an \(andere Regel\)/);
  // Eine Stunde daneben, Einstellungen aber wie gewollt (oder noch nicht gelesen).
  assert.deepEqual(clockPlan({ offsetS: 3600, settings: settingsOf() }, CLOCK_TARGET_BERLIN).steps, [
    "Zeitzone und Sommerzeit prüfen (Abweichung +1 h)",
  ]);
  const unread = clockPlan({ offsetS: 3600, settings: null }, CLOCK_TARGET_BERLIN);
  assert.equal(unread.state, "Einstellungen noch nicht gelesen");
  // Drift mit Zeitserver im Standort-Netz, ausserhalb, und ohne lesbaren Zeitserver.
  assert.deepEqual(clockPlan({ offsetS: 45, settings: settingsOf() }, CLOCK_TARGET_BERLIN).steps, [
    "Zeitserver prüfen (Uhr läuft trotz Zeitserver ab)",
  ]);
  assert.deepEqual(clockPlan({ offsetS: 45, settings: settingsOf(getTime(), getNtp(1, "pool.ntp.org")) }, CLOCK_TARGET_BERLIN).steps, [
    "Zeitserver prüfen (außerhalb des Standort-Netzes, Uhr läuft trotz Zeitserver ab)",
  ]);
  assert.deepEqual(clockPlan({ offsetS: 45, settings: settingsOf(getTime(), null) }, CLOCK_TARGET_BERLIN).steps, [
    "Uhr stellen oder Zeitserver prüfen",
  ]);
  // Ziel mit Zeitserver im Standort-Netz.
  assert.deepEqual(
    clockPlan({ offsetS: 0, settings: settingsOf(getTime(), getNtp(1, "pool.ntp.org")) }, { ...CLOCK_TARGET_BERLIN, ntpLocal: true }).steps,
    ["Zeitserver im Standort-Netz eintragen"]
  );
});

test("clockPlan: jede Abweichung von der EU-Regel zaehlt, auch nur der Wochentag am Ende der Sommerzeit", () => {
  // Reolink-Feld in GetTime.Dst und ein Wert, der von der EU-Regel abweicht.
  for (const [field, value] of [
    ["offset", 2],
    ["startMon", 4],
    ["startWeek", 4],
    ["startWeekday", 1],
    ["endMon", 9],
    ["endWeek", 4],
    ["endWeekday", 1],
  ] as const) {
    const plan = clockPlan({ offsetS: 0, settings: settingsOf(getTime({ dst: { [field]: value } })) }, CLOCK_TARGET_BERLIN);
    assert.match(plan.state, /Sommerzeit an \(andere Regel\)/, field);
    assert.deepEqual(plan.steps, ["Sommerzeit-Regel auf EU (letzter Sonntag im März bis letzter Sonntag im Oktober)"], field);
    assert.match(clockPlanLine("Eingang", 0, plan), / – Vorschlag: Sommerzeit-Regel auf EU/, field);
  }
});

test("clockPlan: keine Adresse ausserhalb des Standort-Netzes in Zeile und Schluessel", () => {
  const plan = clockPlan({ offsetS: 45, settings: settingsOf(getTime(), getNtp(1, "pool.ntp.org")) }, CLOCK_TARGET_BERLIN);
  const line = clockPlanLine("Eingang", 45, plan);
  assert.doesNotMatch(line, /pool\.ntp\.org/);
  assert.doesNotMatch(plan.key, /pool\.ntp\.org/);
  assert.match(line, /Zeitserver an \(außerhalb des Standort-Netzes\)/);
});

test("clockPlan: Schluessel bleibt bei langsam weiterlaufender Uhr gleich", () => {
  const s = settingsOf();
  const key = (o: number) => clockPlan({ offsetS: o, settings: s }, CLOCK_TARGET_BERLIN).key;
  assert.equal(key(40), key(50));
  assert.notEqual(key(40), key(100));
  assert.equal(key(0), key(2));
  assert.notEqual(key(0), key(3600));
});

test("clockSettingsDue und clockPlanDue: einmal am Tag, Plan auch bei Aenderung", () => {
  const T = Date.UTC(2026, 10, 26, 9, 0, 0);
  const memo: ClockMemo = { settingsAt: T, settings: settingsOf(), planKey: "a", planAt: T };
  assert.equal(clockSettingsDue(undefined, T), true);
  assert.equal(clockSettingsDue(memo, T + CLOCK_DAY_MS - 1), false);
  assert.equal(clockSettingsDue(memo, T + CLOCK_DAY_MS), true);
  assert.equal(clockSettingsDue(memo, T - 1), true);
  const affected = (key: string) => ({ kind: "drift" as const, steps: ["Uhr stellen oder Zeitserver prüfen"], key });
  assert.equal(clockPlanDue(memo, affected("a"), T + 60_000), false);
  assert.equal(clockPlanDue(memo, affected("b"), T + 60_000), true);
  assert.equal(clockPlanDue(memo, affected("a"), T + CLOCK_DAY_MS), true);
  assert.equal(clockPlanDue(undefined, affected("a"), T), true);
  // Nur ein Vorschlag, die Uhr selbst im Takt: auch betroffen.
  assert.equal(clockPlanDue({ ...memo, planKey: null }, { kind: "ok", steps: ["Zeitserver einschalten"], key: "c" }, T), true);
});

test("clockPlanDue: eine Kamera ohne Befund bekommt keine Zeile, nur einmal nach einer gemeldeten Abweichung", () => {
  const T = Date.UTC(2026, 10, 26, 9, 0, 0);
  const fine = clockPlan({ offsetS: 1, settings: settingsOf() }, CLOCK_TARGET_BERLIN);
  const off = clockPlan({ offsetS: 3600, settings: settingsOf() }, CLOCK_TARGET_BERLIN);
  assert.equal(clockPlanAffected(fine), false);
  assert.equal(clockPlanAffected(off), true);
  const quiet: ClockMemo = { settingsAt: T, settings: settingsOf(), planKey: null, planAt: 0 };
  // Erster Lauf und jeder weitere Tag: keine Zeile.
  assert.equal(clockPlanDue(undefined, fine, T), false);
  assert.equal(clockPlanDue(quiet, fine, T), false);
  assert.equal(clockPlanDue(quiet, fine, T + 3 * CLOCK_DAY_MS), false);
  // Nach einer gemeldeten Abweichung: einmal „im Takt“, danach gemerkt ohne Schluessel.
  const reported: ClockMemo = { ...quiet, planKey: clockPlanKeyAfter(off), planAt: T };
  assert.equal(reported.planKey, off.key);
  assert.equal(clockPlanDue(reported, fine, T + 60_000), true);
  assert.equal(clockPlanKeyAfter(fine), null);
  assert.equal(clockPlanDue({ ...reported, planKey: clockPlanKeyAfter(fine), planAt: T + 60_000 }, fine, T + 2 * CLOCK_DAY_MS), false);
});

test("Gemerkter Stand: hin und zurueck, Altes und Kaputtes faellt weg", () => {
  const T = Date.UTC(2026, 10, 26, 9, 0, 0);
  const memos = new Map<number, ClockMemo>([
    [1, { settingsAt: T - 3_600_000, settings: settingsOf(), planKey: "k", planAt: T - 60_000 }],
    [2, { settingsAt: T - 3 * CLOCK_DAY_MS, settings: settingsOf(), planKey: null, planAt: 0 }],
  ]);
  const back = parseClockMemo(JSON.parse(serializeClockMemo(memos)), T);
  assert.deepEqual([...back.keys()], [1]);
  assert.deepEqual(back.get(1), memos.get(1));
  assert.deepEqual(parseClockMemo(null, T).size, 0);
  assert.deepEqual(parseClockMemo({ cameras: { x: {}, 3: { settingsAt: T + 1, settings: {} } } }, T).size, 0);
});

test("Kamera-Uhren: der Hub schickt keinen schreibenden Zeit-Befehl an eine Kamera", () => {
  for (const file of ["cameras.ts", "camera-clock.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /"Set(Time|Ntp)"/, file);
  }
});
