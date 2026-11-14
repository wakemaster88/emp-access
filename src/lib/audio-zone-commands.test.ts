import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMAND_TIMEOUT_MS,
  FAILED_VISIBLE_MS,
  resolveCommands,
  type ZoneCommandState,
  type ZoneJobState,
  type ZoneLiveState,
} from "./audio-zone-commands";

const SINCE = Date.parse("2026-11-14T18:00:00.000Z");

function zone(patch: Partial<ZoneLiveState> = {}): Map<number, ZoneLiveState> {
  return new Map([[1, { isPlaying: false, externalActive: null, deviceOnline: true, ...patch }]]);
}

function job(patch: Partial<ZoneJobState> = {}): ZoneJobState {
  return {
    zoneId: 1,
    kind: "PLAY",
    status: "DONE",
    errorMessage: null,
    createdAt: new Date(SINCE + 1000).toISOString(),
    ...patch,
  };
}

function waiting(action: "PLAY" | "STOP" = "PLAY"): Map<number, ZoneCommandState> {
  return new Map([[1, { action, phase: "waiting", since: SINCE }]]);
}

test("Start gilt als bestätigt, sobald die Zone spielt und der Job erledigt ist", () => {
  const result = resolveCommands(waiting(), zone({ isPlaying: true }), [job()], SINCE + 5000);
  assert.equal(result.has(1), false);
});

test("Start bleibt offen, solange der Abspieler noch nicht meldet", () => {
  const commands = waiting();
  const result = resolveCommands(commands, zone(), [job({ status: "SENT" })], SINCE + 5000);
  // Unverändert: dieselbe Map, damit der Aufrufer keinen neuen Zustand setzt.
  assert.equal(result, commands);
});

test("Ein fehlgeschlagener Job zeigt den Grund des Abspielers", () => {
  const result = resolveCommands(
    waiting(),
    zone(),
    [job({ status: "FAILED", errorMessage: "Außerhalb der Musikzeit – nicht gestartet" })],
    SINCE + 5000
  );
  const state = result.get(1);
  assert.equal(state?.phase, "failed");
  assert.match(state?.message ?? "", /Start fehlgeschlagen: Außerhalb der Musikzeit/);
});

test("Ältere Jobs derselben Zone zählen nicht für den neuen Befehl", () => {
  const old = job({ status: "FAILED", createdAt: new Date(SINCE - 60_000).toISOString() });
  const commands = waiting();
  assert.equal(resolveCommands(commands, zone(), [old], SINCE + 5000), commands);
});

test("Nach Ablauf der Wartezeit nennt die Karte den wahrscheinlichen Grund", () => {
  const late = SINCE + COMMAND_TIMEOUT_MS + 1000;
  const offline = resolveCommands(waiting(), zone({ deviceOnline: false }), [], late).get(1);
  assert.match(offline?.message ?? "", /offline/);

  const notFetched = resolveCommands(waiting(), zone(), [job({ status: "PENDING" })], late).get(1);
  assert.match(notFetched?.message ?? "", /noch nicht abgeholt/);

  const silent = resolveCommands(waiting(), zone(), [job()], late).get(1);
  assert.match(silent?.message ?? "", /keine Wiedergabe/);
});

test("Stopp gilt als bestätigt, sobald die Zone nicht mehr spielt", () => {
  const result = resolveCommands(waiting("STOP"), zone(), [job({ kind: "STOP" })], SINCE + 3000);
  assert.equal(result.has(1), false);
});

test("Eine Übernahme per AirPlay zählt als laufende Zone", () => {
  const result = resolveCommands(waiting(), zone({ externalActive: "AIRPLAY" }), null, SINCE + 3000);
  assert.equal(result.has(1), false);
});

test("Eine Fehlermeldung verschwindet nach einer Minute", () => {
  const failed = new Map<number, ZoneCommandState>([
    [1, { action: "PLAY", phase: "failed", since: SINCE, message: "x" }],
  ]);
  assert.equal(resolveCommands(failed, zone(), null, SINCE + 1000).has(1), true);
  assert.equal(resolveCommands(failed, zone(), null, SINCE + FAILED_VISIBLE_MS + 1).has(1), false);
});
