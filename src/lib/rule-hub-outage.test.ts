/**
 * Notbetrieb ueber beide Seiten: Der Hub fuehrt einen Termin aus seinem Plan
 * aus (hub/src/outage-rules.ts), die Cloud wertet den gemeldeten Lauf aus
 * (rule-due.ts, room-rules.ts). Ein gelungener Lauf erledigt den Termin; ein
 * gescheiterter nicht: Die Cloud holt nach ihrer Rueckkehr die Aktionen nach,
 * die beim Hub scheiterten, oder meldet den Termin nach Fristende.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hubRunOccurrence } from "./room-rules";
import {
  RULE_CATCH_UP_MS,
  actionKeys,
  MISSED_HUB_WAIT_MS,
  hubMayHaveRun,
  hubRunAnnounced,
  hubRunScope,
  hubRunsLocally,
  missedDecision,
  nextDueStep,
  parseHubRulesReport,
  readHubRulesReport,
  summarizeAttempts,
  type ActionShape,
  type AttemptRow,
  type HubRuleState,
  type RuleOccurrence,
} from "./rule-due";
import {
  OUTAGE_AFTER_MS,
  SKIP_BEFORE_CONTACT,
  SKIP_NEVER_OPENS,
  announcedFires,
  dueInOutage,
  hubRunRecord,
  outageActionStep,
  outageDue,
  type HubRun,
  type OutageDevice,
  type RunDetail,
} from "../../hub/src/outage-rules";

const MIN = 60_000;
// Betriebsende 22:00 (MEZ) am Samstag, 28.11.2026.
const AT = new Date("2026-11-28T21:00:00.000Z");
const OCC: RuleOccurrence = { at: AT, until: new Date(AT.getTime() + RULE_CATCH_UP_MS), ymd: "2026-11-28" };

const ACTIONS: ActionShape[] = [
  { id: 11, kind: "DEVICE", deviceId: 5, deviceAction: "deactivate" },
  { id: 12, kind: "DEVICE", deviceId: 6, deviceAction: "open" },
  { id: 13, kind: "NOTIFY", channel: "PUSH" },
];
const DEVICES: Record<number, OutageDevice> = {
  5: { type: "SHELLY", category: "BELEUCHTUNG", ipAddress: "192.168.1.20" },
  6: { type: "SHELLY", category: "TASTER", ipAddress: "192.168.1.21" },
};
const KEYS = actionKeys(ACTIONS);

/** Was der Hub im Notbetrieb aus dem Plan macht; `reachable`: Geraete im LAN erreichbar. */
function hubRun(lastContact: number, now: number, reachable = true): HubRun | null {
  const window = outageDue(AT.getTime(), lastContact, now, false, OCC.until.getTime());
  if (!window) return null;
  const ctx = { timed: true, beforeContact: window === "before-contact" };
  const details: RunDetail[] = ACTIONS.map((a) => {
    const step = outageActionStep(
      { kind: a.kind, deviceId: a.deviceId ?? null, deviceAction: a.deviceAction ?? null },
      a.deviceId ? DEVICES[a.deviceId] : null,
      ctx,
    );
    const base = { actionId: a.id, key: KEYS.get(a.id), kind: a.kind, target: a.kind };
    if ("skip" in step) return { ...base, ok: false, error: step.skip };
    return reachable ? { ...base, ok: true } : { ...base, ok: false, error: "Zeitüberschreitung" };
  });
  return hubRunRecord({
    ruleId: 1,
    triggerKind: "closing",
    startedAt: now,
    finishedAt: now + 400,
    fireAt: AT.toISOString(),
    details,
  });
}

/** So steht der gemeldete Lauf in `RoomRuleRun` (room-rules.ts, `recordHubRuleRuns`). */
function row(run: HubRun): AttemptRow {
  return {
    triggerKind: `hub:${run.triggerKind}`,
    triggeredAt: new Date(run.at),
    success: run.success,
    details: run.details,
    errorMessage: run.errorMessage,
  };
}

const cloudFailed: AttemptRow = {
  triggerKind: "closing",
  triggeredAt: new Date(AT.getTime() + 20_000),
  success: false,
  details: ACTIONS.map((a) => ({ actionId: a.id, key: KEYS.get(a.id), ok: false, error: "Gerät offline" })),
  errorMessage: "Gerät offline",
};

/** So steht das Lebenszeichen des Hubs in HubAgent.status (heartbeat-Route, `parseHubRulesReport`). */
function heartbeat(at: number, pending: HubRun[] = []): HubRuleState {
  const report = parseHubRulesReport(
    {
      mode: "cloud",
      pending: pending.length,
      fires: announcedFires(pending),
      coverClose: true,
      planUntil: new Date(at + 40 * 3_600_000).toISOString(),
    },
    new Date(at),
  );
  return { lastSeenAt: new Date(at), rules: readHubRulesReport(report) };
}

/** Rolltor zu am Betriebsende: so sieht die Cloud die Regel „Rolltore zu“. */
const GATE: ActionShape[] = [{ id: 21, kind: "DEVICE", deviceId: 9, deviceAction: "close" }];
const GATE_KEYS = actionKeys(GATE);
const GATE_HUB_KEYS = new Set(GATE_KEYS.values());
const gateCloudFailed: AttemptRow = {
  triggerKind: "closing",
  triggeredAt: new Date(AT.getTime() + 8_500),
  success: false,
  details: [{ actionId: 21, key: GATE_KEYS.get(21), kind: "DEVICE", ok: false, error: "Gerät offline" }],
  errorMessage: "Rolltor: Gerät offline",
};
function gateHubRun(ok: boolean): HubRun {
  return hubRunRecord({
    ruleId: 1,
    triggerKind: "closing",
    startedAt: AT.getTime() + 5_000,
    finishedAt: AT.getTime() + 46_000,
    fireAt: AT.toISOString(),
    details: [
      ok
        ? { actionId: 21, key: GATE_KEYS.get(21), kind: "DEVICE", target: "Rolltor", ok: true }
        : { actionId: 21, key: GATE_KEYS.get(21), kind: "DEVICE", target: "Rolltor", ok: false, error: "Status nicht lesbar" },
    ],
  });
}
/** Schritt der Cloud nach Fristende (room-rules.ts, tickTimedRule): Meldung oder warten. */
function afterDeadline(rows: AttemptRow[], hubState: HubRuleState, now: number) {
  const summary = summarizeAttempts(GATE, rows);
  if (summary.done) return "erledigt";
  return missedDecision(
    {
      missingKeys: [...GATE_KEYS.values()].filter((k) => !summary.okKeys.has(k)),
      hubKeys: GATE_HUB_KEYS,
      hubMayHaveRun: hubMayHaveRun(hubState, 1, OCC, rows),
      until: OCC.until,
    },
    new Date(now),
  );
}

test("Ausfall 10 min, Termin in der Karenz: Hub schaltet Ein/Aus, Impuls und Push holt die Cloud nach", () => {
  const lastContact = AT.getTime() - 30_000;
  const outageSince = lastContact + OUTAGE_AFTER_MS + 20_000;
  const run = hubRun(lastContact, outageSince);
  assert.ok(run);
  assert.equal(run.success, false);
  assert.equal(run.details.find((d) => d.actionId === 11)?.ok, true);
  assert.equal(run.details.find((d) => d.actionId === 12)?.ok, false);

  // Waehrend des Ausfalls schweigt der Hub: Die Cloud versucht es weiter (die
  // Geraete sind fuer sie ebenso offline, der Versuch scheitert ohne Folgen).
  assert.equal(hubRunAnnounced(heartbeat(lastContact), 1, OCC, [cloudFailed]), false);

  // Nach 10 min zurueck: Das Lebenszeichen kuendigt den Lauf an, die Cloud
  // wartet mit dem, was der Hub schaltet.
  const back = AT.getTime() + 10 * MIN;
  assert.equal(hubRunAnnounced(heartbeat(back, [run]), 1, OCC, [cloudFailed]), true);
  // Lauf gemeldet: offen sind nur Impuls und Push, die holt die Cloud nach.
  const summary = summarizeAttempts(ACTIONS, [cloudFailed, row(run)]);
  assert.equal(summary.done, false);
  assert.deepEqual([...summary.okKeys], [KEYS.get(11)]);
  assert.equal(hubRunAnnounced(heartbeat(back, [run]), 1, OCC, [cloudFailed, row(run)]), false);
  assert.equal(nextDueStep([OCC], { lastOccurrenceAt: null, lastMissedAt: null, createdAt: null }, new Date(back)).kind, "run");
  assert.equal(hubRunOccurrence([OCC], new Date(run.at), new Date(run.fireAt as string))?.at.getTime(), AT.getTime());
});

test("Termin im Notbetrieb, alles erreichbar: ein gelungener Lauf erledigt den Termin", () => {
  const actions = ACTIONS.slice(0, 1);
  const lastContact = AT.getTime() - 5 * MIN;
  const now = AT.getTime() + 10_000;
  const run = hubRunRecord({
    ruleId: 1,
    triggerKind: "closing",
    startedAt: now,
    fireAt: AT.toISOString(),
    details: [{ actionId: 11, key: KEYS.get(11), kind: "DEVICE", target: "Licht", ok: true }],
  });
  assert.equal(dueInOutage(AT.getTime(), lastContact, now, false, OCC.until.getTime()), true);
  const summary = summarizeAttempts(actions, [row(run)]);
  assert.equal(summary.done, true);
  // Die Cloud vermerkt den Termin, auch wenn der Hub ihn spaet ausfuehrte (Neustart im Ausfall).
  assert.equal(hubRunOccurrence([OCC], new Date(AT.getTime() + 25 * MIN), AT)?.at.getTime(), AT.getTime());
});

test("Rueckkehr nach 5 min: die Cloud holt gescheiterte Aktionen in der Frist nach", () => {
  const lastContact = AT.getTime() - 2 * MIN;
  const now = AT.getTime() + 30_000;
  const run = hubRun(lastContact, now, false);
  assert.ok(run);
  assert.equal(run.success, false);
  const back = AT.getTime() + 5 * MIN;
  const summary = summarizeAttempts(ACTIONS, [row(run)]);
  assert.equal(summary.done, false);
  assert.equal(summary.okKeys.size, 0);
  assert.equal(nextDueStep([OCC], { lastOccurrenceAt: null, lastMissedAt: null, createdAt: null }, new Date(back)).kind, "run");
  assert.equal(hubRunAnnounced(heartbeat(back), 1, OCC, [row(run)]), false);
});

test("Rueckkehr nach 40 min: Frist vorbei, die Cloud meldet den Termin einmal", () => {
  const lastContact = AT.getTime() - 2 * MIN;
  const run = hubRun(lastContact, AT.getTime() + 30_000, false);
  assert.ok(run);
  const back = AT.getTime() + 40 * MIN;
  assert.equal(summarizeAttempts(ACTIONS, [row(run)]).done, false);
  const step = nextDueStep([OCC], { lastOccurrenceAt: null, lastMissedAt: null, createdAt: null }, new Date(back));
  assert.equal(step.kind, "missed");
  // Nach der Meldung nicht noch einmal.
  assert.equal(nextDueStep([OCC], { lastOccurrenceAt: null, lastMissedAt: AT, createdAt: null }, new Date(back)).kind, "none");
});

test("Termin kurz vor dem letzten Kontakt: der Hub holt nur Aus nach, Impuls und Push bleiben bei der Cloud", () => {
  const run = hubRun(AT.getTime() + 10_000, AT.getTime() + 5 * MIN);
  assert.ok(run);
  assert.deepEqual(
    run.details.map((d) => [d.actionId, d.ok, d.error ?? null]),
    [
      [11, true, null],
      [12, false, SKIP_NEVER_OPENS],
      [13, false, "Im Notbetrieb nicht möglich (braucht die Cloud)"],
    ],
  );
  // Mehr als 6 Minuten vor dem letzten Kontakt: Die Cloud hatte ihren Cron-Lauf.
  assert.equal(hubRun(AT.getTime() + 6 * MIN, AT.getTime() + 9 * MIN), null);
});

/** Rolltor zu und Licht ein zum Betriebsende (Ablauf aus der Nachpruefung, 18:30 statt 22:00). */
const GAP_ACTIONS: ActionShape[] = [
  { id: 31, kind: "DEVICE", deviceId: 9, deviceAction: "close" },
  { id: 32, kind: "DEVICE", deviceId: 5, deviceAction: "open" },
];
const GAP_KEYS = actionKeys(GAP_ACTIONS);
const GAP_DEVICES: Record<number, OutageDevice> = {
  9: { type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.40" },
  5: { type: "SHELLY", category: "BELEUCHTUNG", ipAddress: "192.168.1.20" },
};

/** Lauf des Hubs zum Termin `AT` mit letztem Kontakt `lastContact`, wie rules.ts `tick`. */
function gapHubRun(lastContact: number, now: number, gateOk = true): HubRun | null {
  const window = outageDue(AT.getTime(), lastContact, now, false, OCC.until.getTime());
  if (!window) return null;
  const ctx = { timed: true, coverClose: true, beforeContact: window === "before-contact" };
  return hubRunRecord({
    ruleId: 1,
    triggerKind: "closing",
    startedAt: now,
    finishedAt: now + 41_000,
    fireAt: AT.toISOString(),
    details: GAP_ACTIONS.map((a) => {
      const step = outageActionStep({ kind: a.kind, deviceId: a.deviceId ?? null, deviceAction: a.deviceAction ?? null }, GAP_DEVICES[a.deviceId as number], ctx);
      const base = { actionId: a.id, key: GAP_KEYS.get(a.id), kind: a.kind, target: a.kind };
      if ("skip" in step) return { ...base, ok: false, error: step.skip };
      return gateOk ? { ...base, ok: true } : { ...base, ok: false, error: "Status nicht lesbar" };
    }),
  });
}

/** Hub-Schluessel der Cloud fuer GAP_ACTIONS je nach `hubRunScope` (room-rules.ts, `hubLocalKeys`). */
function gapHubKeys(scope: "all" | "safe" | null): Set<string> {
  const out = new Set<string>();
  if (!scope) return out;
  for (const a of GAP_ACTIONS) {
    if (hubRunsLocally(GAP_DEVICES[a.deviceId as number], a.deviceAction as string, true, scope === "safe")) out.add(GAP_KEYS.get(a.id) as string);
  }
  return out;
}

test("Netz am Standort faellt nach dem Termin und vor dem Cron aus: der Hub schliesst, die Cloud wartet und holt Licht ein nach", () => {
  // 22:00:00 Termin, letztes Lebenszeichen 22:00:00, letzter gelungener Aufruf
  // 22:00:18, Netz weg ab 22:00:20, Cron der Cloud 22:00:41 scheitert.
  const lastContact = AT.getTime() + 18_000;
  const outageStart = lastContact + OUTAGE_AFTER_MS + 20_000;
  const cloudFailed: AttemptRow = {
    triggerKind: "closing",
    triggeredAt: new Date(AT.getTime() + 41_000),
    success: false,
    details: GAP_ACTIONS.map((a) => ({ actionId: a.id, key: GAP_KEYS.get(a.id), ok: false, error: "Gerät offline" })),
    errorMessage: "Gerät offline",
  };
  const run = gapHubRun(lastContact, outageStart);
  assert.ok(run, "der Hub holt den Termin nach");
  assert.deepEqual(run.details.map((d) => [d.key, d.ok, d.error ?? null]), [
    [GAP_KEYS.get(31), true, null],
    [GAP_KEYS.get(32), false, SKIP_BEFORE_CONTACT],
  ]);
  assert.equal(run.success, false);

  // Waehrend des Ausfalls: Die Cloud kann nicht wissen, ob der Hub schliesst; nach Fristende wartet sie.
  const silent = heartbeat(AT.getTime());
  assert.equal(hubRunScope(silent, 1, OCC, [cloudFailed]), "all");
  const summary = summarizeAttempts(GAP_ACTIONS, [cloudFailed]);
  const decide = (hub: HubRuleState, rows: AttemptRow[], now: number) => {
    const s = summarizeAttempts(GAP_ACTIONS, rows);
    if (s.done) return "erledigt";
    const scope = hubRunScope(hub, 1, OCC, rows);
    return missedDecision(
      { missingKeys: [...GAP_KEYS.values()].filter((k) => !s.okKeys.has(k)), hubKeys: gapHubKeys(scope), hubMayHaveRun: scope !== null, until: OCC.until },
      new Date(now),
    );
  };
  assert.equal(summary.done, false);
  // Sein Lebenszeichen kam zum Termin: Sein letzter Kontakt kann davor liegen,
  // dann haette er beides geschaltet. Die Meldung wartet auf seinen Lauf.
  assert.equal(decide(silent, [cloudFailed], OCC.until.getTime()), "wait");
  // Mit seinem Lauf steht fest: Tor zu, Licht ein fehlt; nach Fristende die Meldung.
  assert.equal(decide(heartbeat(AT.getTime() + 40 * MIN), [cloudFailed, row(run)], OCC.until.getTime() + 10 * MIN), "report");

  // Zurueck nach 10 Minuten: Lauf des Hubs da, Tor zu; Licht ein holt die Cloud in der Frist nach.
  const rows = [cloudFailed, row(run)];
  const back = summarizeAttempts(GAP_ACTIONS, rows);
  assert.deepEqual([...back.okKeys], [GAP_KEYS.get(31)]);
  assert.equal(nextDueStep([OCC], { lastOccurrenceAt: null, lastMissedAt: null, createdAt: null }, new Date(AT.getTime() + 10 * MIN)).kind, "run");
  assert.equal(hubRunOccurrence([OCC], new Date(run.at), new Date(run.fireAt as string))?.at.getTime(), AT.getTime());

  // Lebenszeichen 3 Minuten nach dem Termin, dann still: Der Hub kann nur Aus und Zu geschaltet haben.
  const later = heartbeat(AT.getTime() + 3 * MIN);
  assert.equal(hubRunScope(later, 1, OCC, [cloudFailed]), "safe");
  assert.deepEqual([...gapHubKeys("safe")], [GAP_KEYS.get(31)]);
  // Fehlt dann auch Licht ein, meldet die Cloud gleich: Das hat der Hub sicher nicht geschaltet.
  assert.equal(decide(later, [cloudFailed], OCC.until.getTime()), "report");
  // Fehlt nur das Tor (Licht hat die Cloud geschaltet), wartet sie auf ihn.
  const lightOk: AttemptRow = { ...cloudFailed, details: [{ key: GAP_KEYS.get(31), ok: false }, { key: GAP_KEYS.get(32), ok: true }] };
  assert.equal(decide(later, [lightOk], OCC.until.getTime()), "wait");
  // Lebenszeichen 8 Minuten danach ohne Ankuendigung: Er hat den Termin nicht ausgefuehrt.
  assert.equal(hubRunScope(heartbeat(AT.getTime() + 8 * MIN), 1, OCC, [cloudFailed]), null);
});

test("Teilausfall: Cloud hat den Termin geschaltet, der Hub schliesst kurz vor dem Kontakt noch einmal – kein zweiter Termin", () => {
  // Nur der Weg Hub–Cloud gestoert: Der Cron der Cloud schaltet beides um 22:00:41.
  const lastContact = AT.getTime() + 18_000;
  const cloudOk: AttemptRow = {
    triggerKind: "closing",
    triggeredAt: new Date(AT.getTime() + 41_000),
    success: true,
    details: GAP_ACTIONS.map((a) => ({ actionId: a.id, key: GAP_KEYS.get(a.id), ok: true })),
    errorMessage: null,
  };
  const run = gapHubRun(lastContact, lastContact + OUTAGE_AFTER_MS + 20_000);
  assert.ok(run);
  // Licht ein schaltet der Hub nicht noch einmal (jemand kann es seither ausgeschaltet haben).
  assert.equal(run.details.find((d) => d.actionId === 32)?.ok, false);
  // Der Lauf gehoert zum selben Termin, der schon erledigt ist: Die Cloud
  // vermerkt ihn nicht neu (markOccurrence setzt nur einen frueheren Stand
  // weiter) und holt nichts nach.
  const s = summarizeAttempts(GAP_ACTIONS, [cloudOk, row(run)]);
  assert.equal(s.done, true);
  assert.equal(hubRunOccurrence([OCC], new Date(run.at), new Date(run.fireAt as string))?.at.getTime(), AT.getTime());
  assert.equal(nextDueStep([OCC], { lastOccurrenceAt: AT, lastMissedAt: null, createdAt: null }, new Date(AT.getTime() + 10 * MIN)).kind, "none");
});

test("Cloud und Hub sind sich einig, welche Aktion einer Zeit-Regel der Hub im Notbetrieb selbst schaltet", async () => {
  const { isHubLocalKind } = await import("./rule-due");
  const categories = [null, "SCHALTER", "BELEUCHTUNG", "TASTER", "TUER", "ROLLTOR", "MARKISE", "DREHKREUZ"];
  const devices: OutageDevice[] = [
    ...categories.flatMap((category) => [
      { type: "SHELLY", category, ipAddress: "192.168.1.30" },
      { type: "SHELLY", category, ipAddress: null },
    ]),
    { type: "HUE_LIGHT", category: "BELEUCHTUNG", ipAddress: null, hueBridgeId: "b", hueLightId: "2" },
    { type: "HUE_LIGHT", category: "BELEUCHTUNG", ipAddress: null },
    { type: "NUKI_SMARTLOCK", category: null, ipAddress: "192.168.1.31" },
    { type: "DOORBIRD", category: null, ipAddress: "192.168.1.32" },
  ];
  const ACTIONS_ALL = ["open", "deactivate", "emergency", "reset", "close", "stop", "activate"];
  let checked = 0;
  // Auch fuer Termine kurz vor dem letzten Kontakt (nur Aus und Zu, `hubRunScope` „safe“).
  for (const beforeContact of [false, true]) {
    for (const coverClose of [true, false]) {
      for (const device of devices) {
        for (const action of ACTIONS_ALL) {
          const step = outageActionStep({ kind: "DEVICE", deviceId: 1, deviceAction: action }, device, { timed: true, coverClose, beforeContact });
          assert.equal(
            hubRunsLocally(device, action, coverClose, beforeContact),
            "run" in step,
            `${device.type} ${device.category} ${device.ipAddress} ${action} coverClose=${coverClose} beforeContact=${beforeContact}`,
          );
          checked++;
        }
      }
    }
    const camera = outageActionStep({ kind: "CAMERA", deviceId: null, deviceAction: null, targetCameraId: 3 }, null, { timed: true, beforeContact });
    assert.equal(isHubLocalKind("CAMERA", beforeContact), "run" in camera, `Kamera beforeContact=${beforeContact}`);
  }
  assert.equal(checked, devices.length * ACTIONS_ALL.length * 2 * 2);
});

test("Rueckkehr nach 40 min, Hub hat das Rolltor geschlossen: keine Meldung „nicht ausgefuehrt“, kein Netz", () => {
  // Netz am Standort weg ab 21:55, Notbetrieb ab 21:58, Termin 22:00.
  const lastContact = AT.getTime() - 5 * MIN;
  assert.equal(dueInOutage(AT.getTime(), lastContact, AT.getTime() + 5_000, false, OCC.until.getTime()), true);
  const run = gateHubRun(true);
  const silent = heartbeat(lastContact);
  // 22:30 und 22:35: Frist vorbei, der Hub schweigt seit vor dem Termin: warten.
  assert.equal(afterDeadline([gateCloudFailed], silent, OCC.until.getTime()), "wait");
  assert.equal(afterDeadline([gateCloudFailed], silent, OCC.until.getTime() + 5 * MIN), "wait");
  // 22:40 zurueck: erst kuendigt das Lebenszeichen den Lauf an, dann trifft er ein.
  const back = AT.getTime() + 40 * MIN;
  assert.equal(afterDeadline([gateCloudFailed], heartbeat(back, [run]), back), "wait");
  assert.equal(afterDeadline([gateCloudFailed, row(run)], heartbeat(back), back), "erledigt");
  assert.equal(hubRunOccurrence([OCC], new Date(run.at), new Date(run.fireAt as string))?.at.getTime(), AT.getTime());
});

test("Rueckkehr nach 40 min, Schliessen im Hub gescheitert: dann die Meldung, mit beiden Versuchen", () => {
  const lastContact = AT.getTime() - 5 * MIN;
  const run = gateHubRun(false);
  const back = AT.getTime() + 40 * MIN;
  assert.equal(afterDeadline([gateCloudFailed], heartbeat(lastContact), OCC.until.getTime()), "wait");
  const rows = [gateCloudFailed, row(run)];
  assert.equal(afterDeadline(rows, heartbeat(back), back), "report");
  assert.equal(summarizeAttempts(GATE, rows).attempts, 2);
});

test("Hub kommt nicht zurueck: nach einer Stunde Wartezeit Meldung „nicht bestaetigt“", () => {
  const silent = heartbeat(AT.getTime() - 5 * MIN);
  assert.equal(afterDeadline([gateCloudFailed], silent, OCC.until.getTime() + MISSED_HUB_WAIT_MS - 1), "wait");
  assert.equal(afterDeadline([gateCloudFailed], silent, OCC.until.getTime() + MISSED_HUB_WAIT_MS), "report-unconfirmed");
});

test("Hub war nach dem Termin erreichbar und hat nichts angekuendigt: sofort melden", () => {
  // Cloud-Versuch gescheitert (Shelly-Cloud gestoert), Hub online bis 22:20, dann still.
  const hubState = heartbeat(AT.getTime() + 20 * MIN);
  assert.equal(afterDeadline([gateCloudFailed], hubState, OCC.until.getTime()), "report");
});

test("Teilausfall (nur der Weg Hub–Cloud gestoert), Cloud-Versuch gelungen: der Hub schliesst noch einmal, Impulse nie", async () => {
  // Bewusst entschieden: Der Hub kann nicht erkennen, ob die Cloud das Geraet
  // ueber die Shelly-Cloud erreicht hat. „zu“ wiederholt er (Verriegelung wie
  // die Cloud, ein geschlossenes Tor bleibt zu); sonst bliebe das Tor bei einem
  // Ausfall des Netzes am Standort offen, bis die Cloud zurueck ist.
  const lastContact = AT.getTime() - 2 * MIN - 40_000; // 21:57:20
  const outageSince = lastContact + OUTAGE_AFTER_MS; // 22:00:20
  const cloudOk: AttemptRow = {
    triggerKind: "closing",
    triggeredAt: new Date(AT.getTime() + 8_500),
    success: true,
    details: [{ actionId: 21, key: GATE_KEYS.get(21), kind: "DEVICE", ok: true }],
    errorMessage: null,
  };
  assert.equal(dueInOutage(AT.getTime(), lastContact, outageSince, false, OCC.until.getTime()), true);
  const ctx = { timed: true, coverClose: true };
  const gate: OutageDevice = { type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.40" };
  assert.deepEqual(outageActionStep({ kind: "DEVICE", deviceId: 9, deviceAction: "close" }, gate, ctx), { run: "cover-close" });
  // Impulse und Dauer-Auf nie: weder ein Termin aus der Karenz (die Cloud kann
  // ihn geschaltet haben, ein zweiter Impuls kehrte um) noch einer nach Beginn
  // des Notbetriebs, an keinem Geraet, das kein Licht und kein Schalter ist.
  // Die Cloud kennt dieselbe Grenze: Solche Aktionen holt sie selbst nach.
  const { hubRunsLocally } = await import("./rule-due");
  const fireTimes = { karenz: AT.getTime() - 90_000, notbetrieb: outageSince + 2 * MIN };
  for (const [name, fireAt] of Object.entries(fireTimes)) {
    assert.equal(dueInOutage(fireAt, lastContact, fireAt + 30_000, false, fireAt + RULE_CATCH_UP_MS), true, name);
    for (const category of ["TUER", "DREHKREUZ", "TASTER", null]) {
      const pulse: OutageDevice = { type: "SHELLY", category, ipAddress: "192.168.1.41" };
      for (const deviceAction of ["open", "emergency"]) {
        for (const c of [ctx, { timed: true, coverClose: false }, {}]) {
          const step = outageActionStep({ kind: "DEVICE", deviceId: 8, deviceAction }, pulse, c);
          assert.equal("run" in step, false, `${name} ${category} ${deviceAction} ${JSON.stringify(c)}`);
        }
        assert.deepEqual(outageActionStep({ kind: "DEVICE", deviceId: 8, deviceAction }, pulse, ctx), { skip: SKIP_NEVER_OPENS });
        assert.equal(hubRunsLocally(pulse, deviceAction, true), false, `Cloud: ${category} ${deviceAction}`);
      }
    }
  }
  // Der Lauf des Hubs steht im Verlauf; die Cloud schaltet danach nichts mehr.
  const rows = [cloudOk, row(gateHubRun(true))];
  assert.equal(summarizeAttempts(GATE, rows).done, true);
});
