import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOSING_NET_AFTER_MS,
  CLOSING_NET_LOOKBACK_MS,
  MISSED_ALERT_LOOKBACK_MS,
  RULE_CATCH_UP_MS,
  RULE_MIN_CATCH_UP_MS,
  actionKeys,
  closingNetDue,
  closingNetSince,
  deviceOfKey,
  MISSED_HUB_WAIT_MS,
  hubFireMatches,
  hubMayHaveRun,
  hubRunAnnounced,
  hubRunScope,
  hubRunsLocally,
  idleActivityTypes,
  idleDue,
  isHubLocalKind,
  isOccurrenceDue,
  lastOccurrenceAfter,
  missedDecision,
  nextDueStep,
  occurrencesAround,
  occurrencesBetween,
  pairedCloseDevices,
  parseHubRulesReport,
  readHubRulesReport,
  rowTouchesDevices,
  scheduleChanged,
  summarizeAttempts,
  type AttemptRow,
  type HubRuleState,
  type OccurrenceEnv,
  type OccurrenceMarks,
  type RuleScheduleFields,
} from "./rule-due";
import type { ScheduleSpec } from "./operating-hours";

const TZ = "Europe/Berlin";

function env(schedule: ScheduleSpec | null = null): OccurrenceEnv {
  return { timezone: TZ, latitude: 51.9, longitude: 8.3, schedule };
}

/** Samstags 10–18 Uhr, ganzjaehrig. */
function samstags(opensAt = "10:00", closesAt = "18:00"): ScheduleSpec {
  return {
    name: "Wochenende",
    seasons: [{ name: "Ganzjährig", startMmDd: "01-01", endMmDd: "12-31", sortOrder: 0, periods: [{ weekday: 5, opensAt, closesAt }] }],
    exceptions: [],
  };
}

const MARKS = { lastOccurrenceAt: null, lastMissedAt: null, createdAt: null };
const TIME_1830 = { trigger: "TIME", timeOfDay: "18:30", offsetMinutes: 0 };

// 2026-11-28 ist ein Samstag; im November gilt MEZ (UTC+1).
test("Termin ist faellig ab der Soll-Zeit und bis 30 Minuten danach", () => {
  const [occ] = occurrencesAround(TIME_1830, env(), new Date("2026-11-28T17:30:41Z")).filter(
    (o) => o.ymd === "2026-11-28",
  );
  assert.equal(occ.at.toISOString(), "2026-11-28T17:30:00.000Z");
  assert.equal(occ.until.getTime() - occ.at.getTime(), RULE_CATCH_UP_MS);
  assert.equal(isOccurrenceDue(occ, new Date("2026-11-28T17:29:59Z"), null), false, "vor der Soll-Zeit");
  assert.equal(isOccurrenceDue(occ, new Date("2026-11-28T17:30:08Z"), null), true, "Cron-Lauf kurz danach");
  assert.equal(isOccurrenceDue(occ, new Date("2026-11-28T17:34:08Z"), null), true, "Cron-Lauf 4 Minuten zu spaet");
  assert.equal(isOccurrenceDue(occ, new Date("2026-11-28T17:59:59Z"), null), true, "letzte Sekunde der Frist");
  assert.equal(isOccurrenceDue(occ, new Date("2026-11-28T18:00:00Z"), null), false, "Frist vorbei");
});

test("nach Erfolg ist derselbe Termin nicht mehr faellig, ein Fehlschlag laesst ihn offen", () => {
  const now = new Date("2026-11-28T17:35:08Z");
  const occs = occurrencesAround(TIME_1830, env(), now);
  // Erster Lauf um 17:30:08 scheiterte: lastOccurrenceAt bleibt beim Vortag.
  const failed = nextDueStep(occs, { ...MARKS, lastOccurrenceAt: new Date("2026-11-27T17:30:00Z") }, now);
  assert.equal(failed.kind, "run");
  // Erfolg vermerkt: auch ein zweiter Cron-Lauf in derselben Minute schaltet nicht.
  const done = { ...MARKS, lastOccurrenceAt: new Date("2026-11-28T17:30:00Z") };
  assert.equal(nextDueStep(occs, done, new Date("2026-11-28T17:30:50Z")).kind, "none");
  assert.equal(nextDueStep(occs, done, now).kind, "none");
});

test("Frist ohne Erfolg: genau eine Meldung, nicht fuer Termine vor dem Anlegen", () => {
  const now = new Date("2026-11-28T18:00:08Z");
  const occs = occurrencesAround(TIME_1830, env(), now);
  const step = nextDueStep(occs, { ...MARKS, lastOccurrenceAt: new Date("2026-11-27T17:30:00Z") }, now);
  assert.equal(step.kind, "missed");
  if (step.kind !== "missed") return;
  assert.equal(step.occurrence.at.toISOString(), "2026-11-28T17:30:00.000Z");
  // Gemeldet: der naechste Cron-Lauf meldet nicht noch einmal.
  const reported = { ...MARKS, lastOccurrenceAt: new Date("2026-11-27T17:30:00Z"), lastMissedAt: step.occurrence.at };
  assert.equal(nextDueStep(occs, reported, new Date("2026-11-28T18:05:08Z")).kind, "none");
  // Regel erst nach dem Termin angelegt: nichts zu melden.
  const created = { ...MARKS, lastOccurrenceAt: new Date("2026-11-28T17:50:00Z"), createdAt: new Date("2026-11-28T17:50:00Z") };
  assert.equal(nextDueStep(occs, created, now).kind, "none");
  // Laengst vorbei (Cron kommt nach Stunden wieder): keine Meldung mehr.
  const late = new Date(step.occurrence.until.getTime() + MISSED_ALERT_LOOKBACK_MS + 1);
  assert.equal(nextDueStep(occurrencesAround(TIME_1830, env(), late), MARKS, late).kind, "none");
});

test("Vorverlegen nach einem Lauf: kein zweiter Lauf am selben Tag", () => {
  // Lief um 18:30, um 18:40 auf 18:35 vorverlegt.
  const now = new Date("2026-11-28T17:40:08Z");
  const occs = occurrencesAround({ ...TIME_1830, timeOfDay: "18:35" }, env(), now);
  assert.equal(nextDueStep(occs, { ...MARKS, lastOccurrenceAt: new Date("2026-11-28T17:30:00Z") }, now).kind, "run");
  // Die Aenderung setzt lastOccurrenceAt auf den Zeitpunkt der Aenderung.
  assert.equal(nextDueStep(occs, { ...MARKS, lastOccurrenceAt: new Date("2026-11-28T17:40:00Z") }, now).kind, "none");
  // Auf spaeter verlegt: laeuft zur neuen Zeit.
  const later = occurrencesAround({ ...TIME_1830, timeOfDay: "18:50" }, env(), new Date("2026-11-28T17:50:08Z"));
  assert.equal(
    nextDueStep(later, { ...MARKS, lastOccurrenceAt: new Date("2026-11-28T17:40:00Z") }, new Date("2026-11-28T17:50:08Z")).kind,
    "run",
  );
});

test("Mitternacht: 00:00 laeuft im ersten Cron-Lauf des neuen Tages", () => {
  const rule = { trigger: "TIME", timeOfDay: "00:00", offsetMinutes: 0 };
  const before = new Date("2026-11-28T22:55:08Z"); // 23:55 Ortszeit
  assert.equal(
    nextDueStep(occurrencesAround(rule, env(), before), { ...MARKS, lastOccurrenceAt: new Date("2026-11-27T23:00:00Z") }, before).kind,
    "none",
  );
  const after = new Date("2026-11-28T23:00:08Z"); // 00:00:08 am Sonntag
  const step = nextDueStep(occurrencesAround(rule, env(), after), { ...MARKS, lastOccurrenceAt: new Date("2026-11-27T23:00:00Z") }, after);
  assert.equal(step.kind, "run");
  if (step.kind === "run") assert.equal(step.occurrence.ymd, "2026-11-29");
});

test("Sommerzeit: 02:30 gibt es am 28.03.2027 nicht, der Termin kommt genau einmal", () => {
  const rule = { trigger: "TIME", timeOfDay: "02:30", offsetMinutes: 0 };
  const day = occurrencesBetween(rule, env(), new Date("2027-03-27T23:00:00Z"), new Date("2027-03-28T21:59:00Z"));
  assert.equal(day.length, 1);
  // Eine Stunde spaeter als die fehlende Uhrzeit: 03:30 MESZ.
  assert.equal(day[0].at.toISOString(), "2027-03-28T01:30:00.000Z");
});

test("Winterzeit: 02:30 gibt es am 31.10.2027 zweimal, der Termin laeuft einmal", () => {
  const rule = { trigger: "TIME", timeOfDay: "02:30", offsetMinutes: 0 };
  const day = occurrencesBetween(rule, env(), new Date("2027-10-30T22:00:00Z"), new Date("2027-10-31T22:59:00Z"));
  assert.equal(day.length, 1);
  const occ = day[0];
  // Lauf zum ersten 02:30 vermerkt: Beim zweiten 02:30 (eine Stunde spaeter) nichts mehr.
  const first = new Date(occ.at.getTime() + 8_000);
  assert.equal(nextDueStep(day, MARKS, first).kind, "run");
  const second = new Date(occ.at.getTime() + 3_600_000 + 8_000);
  assert.equal(nextDueStep(day, { ...MARKS, lastOccurrenceAt: occ.at }, second).kind, "none");
});

test("Betriebsende nach Mitternacht gehoert zum Betriebstag davor", () => {
  const rule = { trigger: "CLOSING", timeOfDay: null, offsetMinutes: 30 };
  const now = new Date("2026-11-29T01:30:41Z"); // So 02:30:41 Ortszeit
  const occs = occurrencesAround(rule, env(samstags("18:00", "02:00")), now);
  const step = nextDueStep(occs, MARKS, now);
  assert.equal(step.kind, "run");
  if (step.kind !== "run") return;
  assert.equal(step.occurrence.ymd, "2026-11-28");
  assert.equal(step.occurrence.at.toISOString(), "2026-11-29T01:30:00.000Z");
});

test("Betriebsbeginn: Nachholen endet spaetestens mit dem Betriebsende", () => {
  const rule = { trigger: "OPENING", timeOfDay: null, offsetMinutes: 0 };
  // Kurzer Betrieb 10:00–10:15: nachholen nur bis 10:15, nicht bis 10:30.
  const [occ] = occurrencesAround(rule, env(samstags("10:00", "10:15")), new Date("2026-11-28T09:00:00Z")).filter(
    (o) => o.ymd === "2026-11-28",
  );
  assert.equal(occ.until.toISOString(), "2026-11-28T09:15:00.000Z");
  // Versatz -30 wie heute: Frist endet mit dem Betriebsbeginn, das Betriebsende liegt spaeter.
  const [early] = occurrencesAround({ ...rule, offsetMinutes: -30 }, env(samstags()), new Date("2026-11-28T09:00:00Z")).filter(
    (o) => o.ymd === "2026-11-28",
  );
  assert.equal(early.at.toISOString(), "2026-11-28T08:30:00.000Z");
  assert.equal(early.until.toISOString(), "2026-11-28T09:00:00.000Z");
  // Betriebsende 2 Minuten nach Beginn: mindestens 6 Minuten Nachholfrist.
  const [short] = occurrencesAround(rule, env(samstags("10:00", "10:02")), new Date("2026-11-28T09:00:00Z")).filter(
    (o) => o.ymd === "2026-11-28",
  );
  assert.equal(short.until.getTime() - short.at.getTime(), RULE_MIN_CATCH_UP_MS);
  assert.equal(short.until.toISOString(), "2026-11-28T09:06:00.000Z");
});

// ─── Versuche zu einem Termin ────────────────────────────────────────────────

const ACTIONS = [
  { id: 11, kind: "DEVICE", deviceId: 16, deviceAction: "close" },
  { id: 12, kind: "DEVICE", deviceId: 27, deviceAction: "close" },
];

function row(patch: Partial<AttemptRow>): AttemptRow {
  return {
    triggerKind: "closing",
    triggeredAt: new Date("2026-11-28T17:30:50Z"),
    success: false,
    details: [],
    errorMessage: null,
    ...patch,
  };
}

test("Schluessel ueberstehen neue IDs, gleiche Aktionen werden durchgezaehlt", () => {
  const a = actionKeys(ACTIONS);
  const b = actionKeys(ACTIONS.map((x) => ({ ...x, id: x.id + 100 })));
  assert.deepEqual([...a.values()], [...b.values()]);
  const twice = actionKeys([
    { id: 1, kind: "NOTIFY", channel: "PUSH" },
    { id: 2, kind: "NOTIFY", channel: "PUSH" },
  ]);
  assert.deepEqual([...twice.values()], ["NOTIFY:PUSH", "NOTIFY:PUSH#2"]);
});

test("Nachholen nur fuer gescheiterte Aktionen", () => {
  const keys = actionKeys(ACTIONS);
  const s = summarizeAttempts(ACTIONS, [
    row({
      details: [
        { actionId: 11, key: keys.get(11), ok: true },
        { actionId: 12, key: keys.get(12), ok: false, error: "Shelly Cloud: offline" },
      ],
      errorMessage: "Rolltor 2: Shelly Cloud: offline",
    }),
  ]);
  assert.equal(s.done, false);
  assert.deepEqual([...s.okKeys], [keys.get(11)]);
  assert.equal(s.lastError, "Rolltor 2: Shelly Cloud: offline");
  assert.equal(s.attempts, 1);
  // Zweiter Versuch schafft den Rest: Termin erledigt.
  const t = summarizeAttempts(ACTIONS, [
    row({ details: [{ key: keys.get(11), ok: true }, { key: keys.get(12), ok: false }] }),
    row({ triggeredAt: new Date("2026-11-28T17:35:50Z"), details: [{ key: keys.get(12), ok: true }] }),
  ]);
  assert.equal(t.done, true);
});

test("Uebergang: Laeufe von vor der Nachholfrist erledigen den Termin", () => {
  // Erfolgreich gelaufen (Details ohne Schluessel).
  assert.equal(summarizeAttempts(ACTIONS, [row({ success: true, details: [{ actionId: 11, ok: true }, { actionId: 12, ok: true }] })]).done, true);
  // Auch ein damals gescheiterter Lauf: Damals gab es genau einen Versuch.
  assert.equal(summarizeAttempts(ACTIONS, [row({ details: [{ actionId: 11, ok: false }] })]).done, true);
  // Kein Lauf im Verlauf: Termin steht noch aus.
  assert.equal(summarizeAttempts(ACTIONS, []).done, false);
});

test("vom Hub gemeldete Laeufe zaehlen je Aktion", () => {
  const s = summarizeAttempts(ACTIONS, [
    row({ triggerKind: "hub:closing", details: [{ actionId: 11, ok: true }, { actionId: 12, ok: false, error: "Nur über die Cloud schaltbar" }] }),
  ]);
  assert.equal(s.done, false);
  assert.equal(s.okKeys.size, 1);
  assert.equal(summarizeAttempts(ACTIONS, [row({ triggerKind: "hub:closing", success: true })]).done, true);
});

test("an den Hub uebergeben: in Arbeit, solange der Auftrag offen ist, erledigt erst mit seinem Ergebnis", () => {
  const cam = [{ id: 5, kind: "CAMERA", targetCameraId: 3, ptzPresetId: 1, autoTrack: null }];
  const key = actionKeys(cam).get(5) as string;
  // Offen: nicht erledigt, nicht gelungen, aber in Arbeit (kein zweiter Auftrag).
  const open = summarizeAttempts(cam, [row({ triggerKind: "time", details: [{ key, ok: false, pending: true, hubTaskId: 812 }] })]);
  assert.equal(open.done, false);
  assert.equal(open.okKeys.size, 0);
  assert.deepEqual([...open.pendingKeys], [key]);
  // Erledigt (Auftrag DONE, Lauf abgeglichen): Termin erledigt.
  const done = summarizeAttempts(cam, [row({ triggerKind: "time", success: true, details: [{ key, ok: true, hubTaskId: 812 }] })]);
  assert.equal(done.done, true);
  assert.equal(done.pendingKeys.size, 0);
  // Gescheitert oder verfallen (abgeglichen): Die Aktion fehlt wieder.
  for (const error of ["Hub: Bridge nicht erreichbar", "Hub hat den Auftrag nicht rechtzeitig abgeholt"]) {
    const failed = summarizeAttempts(cam, [
      row({ triggerKind: "time", details: [{ key, ok: false, hubTaskId: 812, error }], errorMessage: `Kamera: ${error}` }),
    ]);
    assert.equal(failed.done, false);
    assert.equal(failed.okKeys.size, 0);
    assert.equal(failed.pendingKeys.size, 0);
    assert.equal(failed.lastError, `Kamera: ${error}`);
  }
  // Nachgeholt mit neuem Auftrag, der gelingt: erledigt; der alte zaehlt nicht mehr als offen.
  const retried = summarizeAttempts(cam, [
    row({ triggerKind: "time", details: [{ key, ok: false, hubTaskId: 812, error: "Hub: abgelaufen" }] }),
    row({ triggerKind: "time", triggeredAt: new Date("2026-11-28T17:36:00Z"), success: true, details: [{ key, ok: true, hubTaskId: 815 }] }),
  ]);
  assert.equal(retried.done, true);
});

test("Nachhol-Versuch mit Erfolg erledigt den Termin nur, wenn kein Hub-Auftrag mehr offen ist", () => {
  const actions = [
    { id: 11, kind: "DEVICE", deviceId: 16, deviceAction: "close" },
    { id: 13, kind: "DEVICE", deviceId: 40, deviceAction: "deactivate" },
  ];
  const keys = actionKeys(actions);
  const first = row({
    triggerKind: "time",
    details: [
      { key: keys.get(11), ok: false, error: "Gerät offline" },
      { key: keys.get(13), ok: false, pending: true, hubTaskId: 901 },
    ],
    errorMessage: "Rolltor: Gerät offline",
  });
  // Der Nachhol-Versuch schafft das Rolltor; das Licht wartet noch auf den Hub.
  const retry = row({ triggerKind: "time", triggeredAt: new Date("2026-11-28T17:35:50Z"), success: true, details: [{ key: keys.get(11), ok: true }] });
  const s = summarizeAttempts(actions, [first, retry]);
  assert.equal(s.done, false);
  assert.deepEqual([...s.okKeys], [keys.get(11)]);
  assert.deepEqual([...s.pendingKeys], [keys.get(13)]);
});

test("Aenderung am Zeitplan erkennt Uhrzeit, Fenster und Einschalten", () => {
  const base: RuleScheduleFields = {
    trigger: "TIME",
    timeOfDay: "18:30",
    offsetMinutes: 0,
    daysOfWeek: 127,
    roomId: 22,
    operatingScheduleId: null,
    operatingExtent: "SELF",
    operating: "ANY",
    windowStart: null,
    windowEnd: null,
    onlyWhenDark: false,
    isActive: true,
  };
  assert.equal(scheduleChanged(base, { ...base }), false);
  assert.equal(scheduleChanged(base, { ...base, timeOfDay: "18:35" }), true);
  assert.equal(scheduleChanged(base, { ...base, windowStart: "22:00", windowEnd: "08:00" }), true);
  assert.equal(scheduleChanged({ ...base, isActive: false }, base), true);
  assert.equal(scheduleChanged(base, { ...base, isActive: false }), false);
});

// ─── Hub ─────────────────────────────────────────────────────────────────────

const HUB_NOW = new Date("2026-11-28T17:40:00Z");

/** Hub, dessen juengstes Lebenszeichen `sec` Sekunden alt ist und diese Termine ankuendigt. */
function hub(sec: number, fires: Array<{ ruleId: number; fireAt: string }> = [], extra: Partial<{ coverClose: boolean; planUntil: string | null }> = {}): HubRuleState {
  const at = new Date(HUB_NOW.getTime() - sec * 1000);
  const report = parseHubRulesReport({ mode: fires.length ? "hub" : "cloud", pending: fires.length, fires, ...extra }, at);
  return { lastSeenAt: at, rules: readHubRulesReport(report) };
}

const occ1730 = () =>
  occurrencesAround(TIME_1830, env(), new Date("2026-11-28T17:30:00Z")).filter((o) => o.ymd === "2026-11-28")[0];

test("Cloud wartet auf den Lauf des Hubs nur fuer Termine, die er angekuendigt hat", () => {
  const occ = occ1730();
  const fire = { ruleId: 7, fireAt: "2026-11-28T17:30:00.000Z" };
  assert.equal(hubRunAnnounced(null, 7, occ, []), false, "kein Hub");
  assert.equal(hubRunAnnounced({ lastSeenAt: HUB_NOW, rules: null }, 7, occ, []), false, "aelterer Hub ohne Angabe");
  assert.equal(hubRunAnnounced(hub(30, [fire]), 7, occ, []), true, "gerade zurueck, Lauf steht aus");
  assert.equal(hubRunAnnounced(hub(30, [fire]), 8, occ, []), false, "andere Regel");
  assert.equal(hubRunAnnounced(hub(30, [{ ruleId: 7, fireAt: "2026-11-27T17:30:00.000Z" }]), 7, occ, []), false, "Termin von gestern");
  // Angekuendigt und wieder still: Der Lauf steht weiter aus.
  assert.equal(hubRunAnnounced(hub(1800, [fire]), 7, occ, []), true);
  // Sein Lauf ist da: ab jetzt zaehlt der Verlauf.
  const hubRow: AttemptRow = { triggerKind: "hub:time", triggeredAt: occ.at, success: false, details: [], errorMessage: "x" };
  assert.equal(hubRunAnnounced(hub(30, [fire]), 7, occ, [hubRow]), false);
});

test("Schweigender Hub haelt kein Nachholen auf: die Cloud holt 30 Minuten lang nach", () => {
  const occ = occ1730();
  // Seit Stunden still (aus oder im Notbetrieb), Lebenszeichen ohne Ankuendigung.
  for (const sec of [200, 3_600, 6 * 3_600, 45 * 3_600, 3 * 86_400]) {
    assert.equal(hubRunAnnounced(hub(sec), 7, occ, []), false, `${sec} s still`);
  }
  // Cron 4 Minuten zu spaet: auch der erste Versuch schaltet alles.
  assert.equal(hubRunAnnounced(hub(10 * 60), 7, occ, []), false);
});

test("Termin des Hubs gehoert zum Termin der Cloud, auch auf die Minute gerundet", () => {
  const occ = occ1730();
  assert.equal(hubFireMatches(occ, occ.at.getTime()), true);
  assert.equal(hubFireMatches(occ, occ.at.getTime() - 30_000), true, "Sonnen-Termin, Plan rundet vor");
  assert.equal(hubFireMatches(occ, occ.at.getTime() - 3 * 60_000), true);
  assert.equal(hubFireMatches(occ, occ.at.getTime() - 3 * 60_000 - 1), false);
  assert.equal(hubFireMatches(occ, occ.until.getTime() - 1), true);
  assert.equal(hubFireMatches(occ, occ.until.getTime()), false);
});

test("Kann der Hub den Termin geschaltet haben? Nur still seit vor dem Termin, mit Plan, ohne gemeldeten Lauf", () => {
  const occ = occ1730();
  const plan = { planUntil: "2026-11-30T12:00:00.000Z" };
  // HUB_NOW ist 17:40, Termin 17:30.
  assert.equal(hubMayHaveRun(hub(15 * 60, [], plan), 7, occ, []), true, "still seit 17:25");
  assert.equal(hubMayHaveRun(hub(15 * 60, [], { planUntil: null }), 7, occ, []), false, "ohne Plan");
  assert.equal(hubMayHaveRun(hub(15 * 60, [], { planUntil: "2026-11-28T17:00:00.000Z" }), 7, occ, []), false, "Plan endet vorher");
  assert.equal(hubMayHaveRun(hub(60, [], plan), 7, occ, []), false, "Lebenszeichen 17:39 ohne Ankuendigung");
  // Lebenszeichen kurz nach dem Termin: nach einem Absturz kann der Hub einen etwas aelteren Kontakt kennen.
  assert.equal(hubMayHaveRun(hub(9 * 60 + 30, [], plan), 7, occ, []), true, "Lebenszeichen 17:30:30");
  assert.equal(hubMayHaveRun(hub(30, [{ ruleId: 7, fireAt: "2026-11-28T17:30:00.000Z" }], plan), 7, occ, []), true, "angekuendigt");
  const hubRow: AttemptRow = { triggerKind: "hub:time", triggeredAt: occ.at, success: true, details: [], errorMessage: null };
  assert.equal(hubMayHaveRun(hub(15 * 60, [], plan), 7, occ, [hubRow]), false, "Lauf des Hubs liegt vor");
  assert.equal(hubMayHaveRun({ lastSeenAt: new Date("2026-11-28T17:00:00Z"), rules: null }, 7, occ, []), false, "aelterer Hub");
  assert.equal(hubMayHaveRun(null, 7, occ, []), false);
});

test("Lebenszeichen bis 6 Minuten nach dem Termin: der Hub kann davon nur Aus und Zu geschaltet haben", () => {
  const occ = occ1730();
  const plan = { planUntil: "2026-11-30T12:00:00.000Z" };
  // HUB_NOW ist 17:40, Termin 17:30.
  assert.equal(hubRunScope(hub(15 * 60, [], plan), 7, occ, []), "all", "still seit 17:25");
  assert.equal(hubRunScope(hub(9 * 60 + 30, [], plan), 7, occ, []), "all", "Lebenszeichen 17:30:30");
  assert.equal(hubRunScope(hub(9 * 60, [], plan), 7, occ, []), "safe", "Lebenszeichen 17:31");
  assert.equal(hubRunScope(hub(7 * 60, [], plan), 7, occ, []), "safe", "Lebenszeichen 17:33");
  assert.equal(hubMayHaveRun(hub(7 * 60, [], plan), 7, occ, []), true);
  assert.equal(hubRunScope(hub(181, [], plan), 7, occ, []), "safe", "Lebenszeichen 17:36:59");
  assert.equal(hubRunScope(hub(180, [], plan), 7, occ, []), null, "Lebenszeichen 17:37");
  assert.equal(hubRunScope(hub(7 * 60, [], { planUntil: null }), 7, occ, []), null, "ohne Plan");
  // Angekuendigt: Sein Lauf zeigt gleich, was er schaltete; bis dahin alles.
  assert.equal(hubRunScope(hub(30, [{ ruleId: 7, fireAt: "2026-11-28T17:30:00.000Z" }], plan), 7, occ, []), "all");
  // Aus und Zu schaltet er auch dann, Ein und Kamera-Szene nicht.
  const light = { type: "SHELLY", category: "BELEUCHTUNG", ipAddress: "192.168.1.20" };
  assert.equal(hubRunsLocally(light, "deactivate", false, true), true);
  assert.equal(hubRunsLocally(light, "reset", false, true), true);
  assert.equal(hubRunsLocally(light, "open", false, true), false);
  assert.equal(hubRunsLocally(light, "emergency", false, true), false);
  assert.equal(hubRunsLocally({ type: "HUE_LIGHT", hueBridgeId: "b1", hueLightId: "4" }, "open", false, true), false);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.21" }, "close", true, true), true);
  assert.equal(isHubLocalKind("CAMERA", true), false);
});

test("Meldung nach Fristende wartet auf den Hub, wenn nur fehlt, was er schaltet; hoechstens eine Stunde", () => {
  const until = new Date("2026-11-28T18:00:00Z");
  const hubKeys = new Set(["DEVICE:6:close", "CAMERA:2:-:-"]);
  const at = (min: number) => new Date(until.getTime() + min * 60_000);
  const base = { missingKeys: ["DEVICE:6:close"], hubKeys, hubMayHaveRun: true, until };
  assert.equal(missedDecision(base, at(0)), "wait");
  assert.equal(missedDecision(base, at(59)), "wait");
  assert.equal(missedDecision(base, new Date(until.getTime() + MISSED_HUB_WAIT_MS)), "report-unconfirmed");
  assert.equal(missedDecision({ ...base, hubMayHaveRun: false }, at(0)), "report", "Hub kann es nicht gewesen sein");
  assert.equal(missedDecision({ ...base, missingKeys: ["DEVICE:6:close", "NOTIFY:PUSH"] }, at(0)), "report", "Push fehlt");
  assert.equal(missedDecision({ ...base, missingKeys: [] }, at(0)), "report");
  // Die Meldung nach der Wartezeit liegt noch im Zeitraum, in dem gemeldet wird.
  assert.ok(MISSED_HUB_WAIT_MS + 5 * 60_000 < MISSED_ALERT_LOOKBACK_MS);
});

test("Sicherheitsnetz wartet auf den juengsten eigenen Termin seit der Oeffnung", () => {
  const mk = (iso: string) => ({ at: new Date(iso), until: new Date(Date.parse(iso) + RULE_CATCH_UP_MS), ymd: iso.slice(0, 10) });
  const occs = [mk("2026-11-27T17:00:00.000Z"), mk("2026-11-28T17:00:00.000Z"), mk("2026-11-29T17:00:00.000Z")];
  const opened = new Date("2026-11-28T09:00:00Z");
  assert.equal(lastOccurrenceAfter(occs, opened, new Date("2026-11-28T17:40:00Z"))?.ymd, "2026-11-28");
  assert.equal(lastOccurrenceAfter(occs, opened, new Date("2026-11-28T16:00:00Z")), null, "Termin noch nicht erreicht");
  assert.equal(lastOccurrenceAfter(occs, new Date("2026-11-28T17:10:00Z"), new Date("2026-11-28T17:40:00Z")), null, "Oeffnung nach dem Termin");
  assert.equal(lastOccurrenceAfter([], opened, new Date("2026-11-28T17:40:00Z")), null, "Buchung storniert");
});

test("Hub schaltet im Notbetrieb nur Hue, Licht und Schalter mit IP, dazu Rolltor zu; nie etwas, das oeffnet", () => {
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "BELEUCHTUNG", ipAddress: "192.168.1.20" }, "open"), true);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "SCHALTER", ipAddress: "192.168.1.20" }, "reset"), true);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "SCHALTER", ipAddress: "192.168.1.20" }, "activate"), false, "kein Befehl");
  // Tueroeffner, Drehkreuz, Taster, ohne Kategorie: mit keinem Befehl.
  for (const category of ["TUER", "DREHKREUZ", "TASTER", null]) {
    for (const action of ["open", "emergency", "deactivate", "reset", "close"]) {
      assert.equal(hubRunsLocally({ type: "SHELLY", category, ipAddress: "192.168.1.20" }, action, true), false, `${category} ${action}`);
    }
  }
  // Rolltor: der Hub faehrt es im Notbetrieb zu, wenn er das laut Lebenszeichen tut; Auf und Stopp nie.
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.20" }, "close", true), true);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.20" }, "close", false), false, "HUB_EMERGENCY_COVER_CLOSE aus");
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.20" }, "close"), false, "ohne Angabe");
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.20" }, "open", true), false);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.20" }, "stop", true), false);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "ROLLTOR", ipAddress: null }, "close", true), false);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "MARKISE", ipAddress: "192.168.1.20" }, "close", true), false);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: "SCHALTER", ipAddress: "192.168.1.20" }, "close", true), false);
  assert.equal(hubRunsLocally({ type: "SHELLY", category: null, ipAddress: null }, "open"), false);
  assert.equal(hubRunsLocally({ type: "HUE_LIGHT", hueBridgeId: "b1", hueLightId: "4" }, "open"), true);
  assert.equal(hubRunsLocally({ type: "NUKI_SMARTLOCK" }, "open"), false);
});

test("Lebenszeichen: Angabe zu den Regeln wird geprueft", () => {
  const now = new Date("2026-11-28T17:40:00Z");
  assert.deepEqual(parseHubRulesReport({ mode: "cloud", pending: 0 }, now), {
    mode: "cloud",
    pending: 0,
    at: now.toISOString(),
    fires: [],
    coverClose: false,
    planUntil: null,
  });
  assert.equal(parseHubRulesReport({ mode: "x", pending: 0 }, now), null);
  assert.equal(parseHubRulesReport({ mode: "hub", pending: -1 }, now), null);
  assert.equal(parseHubRulesReport(undefined, now), null);
  const full = parseHubRulesReport(
    {
      mode: "hub",
      pending: 2,
      fires: [{ ruleId: 3, fireAt: "2026-11-28T21:00:00.000Z" }, { ruleId: "x", fireAt: "y" }, { ruleId: 4 }],
      coverClose: true,
      planUntil: "2026-11-30T12:00:00.000Z",
    },
    now,
  );
  assert.deepEqual(full?.fires, [{ ruleId: 3, fireAt: "2026-11-28T21:00:00.000Z" }]);
  assert.equal(full?.coverClose, true);
  assert.equal(full?.planUntil, "2026-11-30T12:00:00.000Z");
  const many = parseHubRulesReport(
    { mode: "hub", pending: 500, fires: Array.from({ length: 500 }, (_, i) => ({ ruleId: i + 1, fireAt: now.toISOString() })) },
    now,
  );
  assert.equal(many?.fires.length, 100);
  // Gespeichert und wieder gelesen.
  const read = readHubRulesReport(full);
  assert.equal(read?.fires[0].fireAt, Date.parse("2026-11-28T21:00:00.000Z"));
  assert.equal(read?.planUntil?.toISOString(), "2026-11-30T12:00:00.000Z");
  assert.equal(read?.at?.toISOString(), now.toISOString());
  // Frueherer Stand ohne die neuen Felder.
  assert.deepEqual(readHubRulesReport({ mode: "cloud", pending: 0, at: now.toISOString() })?.fires, []);
  assert.equal(readHubRulesReport({ mode: 1 }), null);
});

// ─── Sicherheitsnetz ─────────────────────────────────────────────────────────

const OPEN_ACTIONS = [
  { id: 1, kind: "DEVICE", deviceId: 16, deviceAction: "open" },
  { id: 2, kind: "DEVICE", deviceId: 27, deviceAction: "open" },
];

test("zugehoerig: dieselben Geraete, oeffnen und schliessen", () => {
  assert.deepEqual([...pairedCloseDevices(ACTIONS, [OPEN_ACTIONS])].sort(), [16, 27]);
  // Eine Regel, die nur ein anderes Tor oeffnet, gehoert nicht dazu.
  assert.deepEqual([...pairedCloseDevices(ACTIONS, [[{ kind: "DEVICE", deviceId: 40, deviceAction: "open" }]])], []);
  // Ausschalten ist kein Schliessen.
  assert.deepEqual([...pairedCloseDevices([{ kind: "DEVICE", deviceId: 16, deviceAction: "deactivate" }], [OPEN_ACTIONS])], []);
  // Eine Regel „Betriebsbeginn“, die das Tor nur schliesst, oeffnet nichts: nicht zugehoerig.
  assert.deepEqual([...pairedCloseDevices(ACTIONS, [[{ kind: "DEVICE", deviceId: 16, deviceAction: "close" }]])], []);
  assert.deepEqual([...pairedCloseDevices(ACTIONS, [[{ kind: "DEVICE", deviceId: 16, deviceAction: "stop" }], OPEN_ACTIONS.slice(1)])], [27]);
});

test("Lauf hat die Geraete geoeffnet bzw. geschlossen", () => {
  const devices = new Set([16, 27]);
  const byId = new Map([
    [1, { deviceId: 16, deviceAction: "open" }],
    [2, { deviceId: 27, deviceAction: "open" }],
  ]);
  assert.equal(rowTouchesDevices(row({ details: [{ actionId: 1, ok: true }, { actionId: 2, ok: true }] }), byId, devices, "open"), "ok");
  assert.equal(rowTouchesDevices(row({ details: [{ actionId: 1, ok: true }, { actionId: 2, ok: false }] }), byId, devices, "open"), "partial");
  assert.equal(rowTouchesDevices(row({ details: [{ actionId: 1, ok: false }, { actionId: 2, ok: false }] }), byId, devices, "open"), "failed");
  assert.equal(rowTouchesDevices(row({ details: [{ deviceId: 16, deviceAction: "close", ok: true } as never] }), new Map(), devices, "close"), "ok");
  assert.equal(rowTouchesDevices(row({ details: [] }), byId, devices, "close"), "none");
});

test("Lauf des Hubs nach dem Speichern der Regel: Geraet aus dem Schluessel", () => {
  const devices = new Set([16, 27]);
  // Neu gespeichert: Die Aktionen haben neue IDs, der Lauf traegt die alten.
  const now = new Map([
    [31, { deviceId: 16, deviceAction: "close" }],
    [32, { deviceId: 27, deviceAction: "close" }],
  ]);
  const hubRun = (ok16: boolean, ok27: boolean) =>
    row({
      triggerKind: "hub:closing",
      details: [
        { actionId: 11, key: "DEVICE:16:close", ok: ok16 },
        { actionId: 12, key: "DEVICE:27:close", ok: ok27 },
      ],
    });
  assert.equal(rowTouchesDevices(hubRun(true, true), now, devices, "close"), "ok");
  assert.equal(rowTouchesDevices(hubRun(true, false), now, devices, "close"), "partial");
  assert.equal(rowTouchesDevices(hubRun(false, false), now, devices, "close"), "failed");
  assert.equal(rowTouchesDevices(hubRun(true, true), now, devices, "open"), "none");
  // Gezaehlte gleiche Aktionen, andere Arten und kaputte Schluessel
  assert.deepEqual(deviceOfKey("DEVICE:16:close#2"), { deviceId: 16, deviceAction: "close" });
  assert.equal(deviceOfKey("DEVICE:-:close"), null);
  assert.equal(deviceOfKey("DEVICE:16:-"), null);
  assert.equal(deviceOfKey("DEVICE:0:close"), null);
  assert.equal(deviceOfKey("NOTIFY:PUSH"), null);
  assert.equal(deviceOfKey("CAMERA:16:3:-"), null);
  assert.equal(deviceOfKey(16), null);
  assert.equal(deviceOfKey(undefined), null);
});

test("Sicherheitsnetz: schliesst nach Storno einmal, nie waehrend Betrieb oder eigenem Termin", () => {
  const opened = new Date("2026-11-29T08:30:00Z");
  const base = {
    lastOpenedAt: opened,
    lastClosedAt: new Date("2026-11-22T17:30:50Z"),
    lastNetAt: null,
    operatingNearby: false,
    ownPending: false,
  };
  const later = new Date(opened.getTime() + CLOSING_NET_AFTER_MS);
  assert.equal(closingNetDue(base, later), true, "Buchung storniert, seit 30 min kein Betrieb");
  assert.equal(closingNetDue(base, new Date(opened.getTime() + 5 * 60_000)), false, "gerade erst geoeffnet");
  assert.equal(closingNetDue({ ...base, operatingNearby: true }, later), false, "Betrieb laeuft oder beginnt gleich");
  assert.equal(closingNetDue({ ...base, ownPending: true }, later), false, "eigener Termin kommt noch");
  assert.equal(closingNetDue({ ...base, lastClosedAt: new Date(opened.getTime() + 60_000) }, later), false, "schon geschlossen");
  assert.equal(closingNetDue({ ...base, lastNetAt: new Date(opened.getTime() + 60_000) }, later), false, "Netz lief schon");
  assert.equal(closingNetDue({ ...base, lastOpenedAt: null }, later), false, "nie geoeffnet");
});

test("Sicherheitsnetz: Oeffnungen zaehlen erst ab Anlegen der Regel, hoechstens sieben Tage zurueck, auch nach einer Aenderung", () => {
  const now = new Date("2026-11-28T17:00:00Z");
  const old = new Date("2026-10-01T08:00:00Z");
  const openedToday = new Date("2026-11-28T06:45:00Z");
  // Alte Regel: sieben Tage zurueck.
  assert.equal(closingNetSince({ createdAt: old }, now).getTime(), now.getTime() - CLOSING_NET_LOOKBACK_MS);
  // Neu angelegt: ab dem Anlegen, nicht ab der Oeffnung von vor sechs Tagen.
  const created = new Date("2026-11-28T16:30:00Z");
  assert.equal(closingNetSince({ createdAt: created }, now).getTime(), created.getTime());
  assert.ok(openedToday.getTime() < closingNetSince({ createdAt: created }, now).getTime());
  // Zeitplan heute nach der Oeffnung geaendert oder Regel wieder eingeschaltet (neuer Vermerk):
  // Die Oeffnung von heute frueh zaehlt weiter, scheitert der Termin danach, schliesst das Netz.
  const changed = new Date("2026-11-28T11:00:00Z");
  const rule = { createdAt: old, lastOccurrenceAt: changed };
  assert.equal(closingNetSince(rule, now).getTime(), now.getTime() - CLOSING_NET_LOOKBACK_MS);
  assert.ok(openedToday.getTime() >= closingNetSince(rule, now).getTime());
});

// ─── Krumme Minuten und Sonnenzeiten ─────────────────────────────────────────

/**
 * Cron-Laeufe wie in Betrieb (alle 5 Minuten, 8,5 bzw. 41,5 s nach der
 * Marke) von `fromIso` bis `toIso`; jeder Lauf gelingt. Ergebnis: die Laeufe
 * mit Zeitpunkt und Termin.
 */
function simulate(
  rule: { trigger: string; timeOfDay: string | null; offsetMinutes: number },
  e: OccurrenceEnv,
  fromIso: string,
  toIso: string,
  startDelayMs = 8_500,
): Array<{ at: Date; occurrence: { at: Date; ymd: string } }> {
  const runs: Array<{ at: Date; occurrence: { at: Date; ymd: string } }> = [];
  let marks: OccurrenceMarks = { ...MARKS };
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  for (let mark = from; mark <= to; mark += 5 * 60_000) {
    const now = new Date(mark + startDelayMs);
    const step = nextDueStep(occurrencesAround(rule, e, now), marks, now);
    if (step.kind !== "run") continue;
    runs.push({ at: now, occurrence: step.occurrence });
    marks = { ...marks, lastOccurrenceAt: step.occurrence.at };
  }
  return runs;
}

test("krumme Minute 07:03: genau ein Lauf, um 07:05:08 und nicht schon um 07:00:08", () => {
  const rule = { trigger: "TIME", timeOfDay: "07:03", offsetMinutes: 0 };
  // 07:03 MEZ = 06:03 UTC; Laeufe von 06:00 bis 07:00 UTC.
  for (const delay of [8_500, 41_500]) {
    const runs = simulate(rule, env(), "2026-11-28T06:00:00Z", "2026-11-28T07:00:00Z", delay);
    assert.equal(runs.length, 1, `Start ${delay} ms nach der Marke`);
    assert.equal(runs[0].at.getTime(), Date.parse("2026-11-28T06:05:00Z") + delay);
  }
});

test("Sonnenuntergang plus 5 Stunden liegt nach Mitternacht UTC und laeuft trotzdem", () => {
  const rule = { trigger: "SUNSET", timeOfDay: null, offsetMinutes: 300 };
  // 30.06.2026: Untergang gegen 21:50 MESZ, plus 5 h also gegen 00:50 UTC am 01.07.
  const runs = simulate(rule, env(), "2026-06-30T22:00:00Z", "2026-07-01T03:00:00Z");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].occurrence.ymd, "2026-06-30");
  assert.equal(runs[0].occurrence.at.toISOString().slice(0, 10), "2026-07-01");
  const lag = runs[0].at.getTime() - runs[0].occurrence.at.getTime();
  assert.ok(lag >= 0 && lag < 5 * 60_000 + 10_000, `Lauf ${lag} ms nach der Soll-Zeit`);
});

test("Sonnenaufgang minus 4 Stunden liegt vor Mitternacht UTC und laeuft trotzdem", () => {
  const rule = { trigger: "SUNRISE", timeOfDay: null, offsetMinutes: -240 };
  // 01.07.2026: Aufgang gegen 05:20 MESZ (03:20 UTC), minus 4 h also gegen 23:20 UTC am 30.06.
  const runs = simulate(rule, env(), "2026-06-30T21:00:00Z", "2026-07-01T02:00:00Z");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].occurrence.ymd, "2026-07-01");
  assert.equal(runs[0].occurrence.at.toISOString().slice(0, 10), "2026-06-30");
});

test("Sonnenzeiten ueber die Zeitumstellung: je Tag genau ein Lauf, puenktlich", () => {
  const rules = [
    { trigger: "SUNSET", timeOfDay: null, offsetMinutes: 0 },
    { trigger: "SUNRISE", timeOfDay: null, offsetMinutes: 0 },
    { trigger: "SUNSET", timeOfDay: null, offsetMinutes: 300 },
    { trigger: "SUNRISE", timeOfDay: null, offsetMinutes: -240 },
  ];
  for (const [fromIso, toIso, days] of [
    ["2027-03-26T00:00:00Z", "2027-03-30T23:55:00Z", ["2027-03-26", "2027-03-27", "2027-03-28", "2027-03-29", "2027-03-30"]],
    ["2027-10-29T00:00:00Z", "2027-11-02T23:55:00Z", ["2027-10-29", "2027-10-30", "2027-10-31", "2027-11-01", "2027-11-02"]],
  ] as const) {
    for (const rule of rules) {
      const runs = simulate(rule, env(), fromIso, toIso);
      const ymds = runs.map((r) => r.occurrence.ymd);
      assert.equal(new Set(ymds).size, ymds.length, `${rule.trigger}${rule.offsetMinutes}: kein Tag doppelt`);
      for (const day of days.slice(1, -1)) {
        assert.ok(ymds.includes(day), `${rule.trigger}${rule.offsetMinutes}: ${day} fehlt`);
      }
      for (const r of runs) {
        const lag = r.at.getTime() - r.occurrence.at.getTime();
        assert.ok(lag >= 0 && lag < 5 * 60_000 + 10_000, `${rule.trigger}${rule.offsetMinutes} ${r.occurrence.ymd}: ${lag} ms`);
      }
    }
  }
});

test("Uhrzeit ueber die Zeitumstellung: je Tag genau ein Lauf zur Ortszeit", () => {
  const rule = { trigger: "TIME", timeOfDay: "07:03", offsetMinutes: 0 };
  const spring = simulate(rule, env(), "2027-03-26T00:00:00Z", "2027-03-29T23:55:00Z");
  assert.deepEqual(
    spring.map((r) => r.occurrence.at.toISOString()),
    ["2027-03-26T06:03:00.000Z", "2027-03-27T06:03:00.000Z", "2027-03-28T05:03:00.000Z", "2027-03-29T05:03:00.000Z"],
  );
  const autumn = simulate(rule, env(), "2027-10-30T00:00:00Z", "2027-11-01T23:55:00Z");
  assert.deepEqual(
    autumn.map((r) => r.occurrence.at.toISOString()),
    ["2027-10-30T05:03:00.000Z", "2027-10-31T06:03:00.000Z", "2027-11-01T06:03:00.000Z"],
  );
});

// ─── Ruhe im Raum ────────────────────────────────────────────────────────────

test("idleDue: ohne Kamera nie, sonst einmal je Ruhephase", () => {
  const now = new Date("2026-11-28T20:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  assert.equal(idleDue(15, ago(60), null, false, now), false, "Raum ohne Kamera");
  assert.equal(idleDue(15, ago(20), null, true, now), true, "Ruhe seit 20 Minuten, noch kein Lauf");
  assert.equal(idleDue(15, ago(10), null, true, now), false, "erst 10 Minuten ruhig");
  assert.equal(idleDue(15, ago(20), ago(4), true, now), false, "schon gelaufen in dieser Ruhephase");
  assert.equal(idleDue(15, ago(40), ago(60), true, now), true, "neue Aktivitaet nach dem Lauf, wieder ruhig");
  assert.equal(idleDue(15, null, ago(120), true, now), false, "seit dem Lauf keine Aktivitaet");
  assert.equal(idleDue(15, null, null, true, now), true, "nie Aktivitaet, nie gelaufen");
  assert.equal(idleDue(null, ago(60), null, true, now), false, "ohne Dauer");
});

test("idleDue: genau an den Grenzen", () => {
  const now = new Date("2026-11-28T20:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  // Genau 15 Minuten ruhig: faellig; eine Millisekunde weniger: nicht.
  assert.equal(idleDue(15, ago(15 * 60_000), null, true, now), true);
  assert.equal(idleDue(15, ago(15 * 60_000 - 1), null, true, now), false);
  // Lauf genau zur letzten Aktivitaet: gehoert zu dieser Ruhephase.
  const last = ago(30 * 60_000);
  assert.equal(idleDue(15, last, new Date(last.getTime()), true, now), false);
  assert.equal(idleDue(15, last, new Date(last.getTime() - 1), true, now), true);
  assert.equal(idleDue(0, ago(60 * 60_000), null, true, now), false, "Dauer 0");
});

test("idleDue: Cron alle 5 Minuten loest je Ruhephase genau einmal aus", () => {
  // Aktivitaet bis 19:00, dann Ruhe; 19:50 wieder jemand da bis 19:55.
  const activity = (t: number) => (t < Date.parse("2026-11-28T19:50:00Z") ? new Date("2026-11-28T19:00:00Z") : new Date("2026-11-28T19:55:00Z"));
  let lastRunAt: Date | null = new Date("2026-11-28T18:00:00Z");
  const runs: string[] = [];
  for (let t = Date.parse("2026-11-28T19:00:08Z"); t < Date.parse("2026-11-28T21:00:00Z"); t += 5 * 60_000) {
    const now = new Date(t);
    const last = activity(t);
    if (t >= Date.parse("2026-11-28T19:50:00Z") && t < Date.parse("2026-11-28T19:55:00Z")) continue; // laeuft gerade
    if (idleDue(15, last, lastRunAt, true, now)) {
      runs.push(now.toISOString().slice(11, 16));
      lastRunAt = now;
    }
  }
  assert.deepEqual(runs, ["19:15", "20:10"]);
});

test("idleActivityTypes: Person und Fahrzeug, Bewegung nur auf Wunsch", () => {
  assert.deepEqual(idleActivityTypes(null), ["PERSON", "VEHICLE"]);
  assert.deepEqual(idleActivityTypes("MOTION"), ["PERSON", "VEHICLE", "MOTION"]);
  assert.deepEqual(idleActivityTypes("PERSON"), ["PERSON"]);
  assert.deepEqual(idleActivityTypes("VEHICLE"), ["VEHICLE"]);
  assert.deepEqual(idleActivityTypes("DOORBELL"), ["PERSON", "VEHICLE"]);
});

test("isHubLocalKind: Kamera-Szenen schaltet der Hub im Notbetrieb selbst, sonst nichts ohne Geraet", () => {
  assert.equal(isHubLocalKind("CAMERA"), true);
  for (const kind of ["DEVICE", "NOTIFY", "AUDIO", "PI", ""]) assert.equal(isHubLocalKind(kind), false, kind);
});
