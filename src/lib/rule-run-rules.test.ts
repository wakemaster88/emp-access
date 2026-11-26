import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HUB_RUN_DETAILS_MAX,
  NOT_ACCEPTED_ERROR,
  SWITCHED_FOLLOW_UP_MAX_MS,
  ownHubTasks,
  pendingHubTaskIds,
  runOutcome,
  runState,
  sanitizeHubRunDetails,
  settleRunDetails,
  switchedFollowUp,
  type HubTaskState,
} from "./rule-run-rules";

const LAMPE = { actionId: 1, kind: "DEVICE", target: "Lampe Eingang", ok: false, pending: true, hubTaskId: 41 };
const KAMERA = { actionId: 2, kind: "CAMERA", target: "Kamera Hof · Preset 2", ok: false, pending: true, hubTaskId: 42 };
const TOR = { actionId: 3, kind: "DEVICE", target: "Rolltor", ok: true };

test("runOutcome: offener Hub-Auftrag ist weder Erfolg noch Fehler", () => {
  assert.deepEqual(runOutcome([TOR, LAMPE]), { success: false, errorMessage: null, pending: 1 });
  assert.deepEqual(runOutcome([TOR]), { success: true, errorMessage: null, pending: 0 });
  assert.deepEqual(runOutcome([]), { success: false, errorMessage: null, pending: 0 });
  assert.deepEqual(runOutcome([{ ...TOR, ok: false, error: "Antrieb blockiert" }, LAMPE]), {
    success: false,
    errorMessage: "Rolltor: Antrieb blockiert",
    pending: 1,
  });
  // Ohne eigene Begruendung: der feste Text.
  assert.equal(runOutcome([{ ...TOR, ok: false }]).errorMessage, `Rolltor: ${NOT_ACCEPTED_ERROR}`);
});

test("pendingHubTaskIds: nur offene Auftraege", () => {
  assert.deepEqual(pendingHubTaskIds([TOR, LAMPE, KAMERA]), [41, 42]);
  assert.deepEqual(pendingHubTaskIds([{ ...LAMPE, pending: false, ok: true }]), []);
  assert.deepEqual(pendingHubTaskIds(null), []);
  assert.deepEqual(pendingHubTaskIds("kaputt"), []);
});

test("settleRunDetails: Ergebnis des Hubs traegt den Lauf nach", () => {
  const tasks = new Map<number, HubTaskState>([
    [41, { status: "DONE", error: null }],
    [42, { status: "RUNNING", error: null }],
  ]);
  const first = settleRunDetails([TOR, LAMPE, KAMERA], tasks);
  assert.equal(first.changed, true);
  assert.deepEqual(first.details[1], { actionId: 1, kind: "DEVICE", target: "Lampe Eingang", ok: true, hubTaskId: 41 });
  assert.equal(first.details[2].pending, true, "Kamera laeuft noch");
  assert.deepEqual(runOutcome(first.details), { success: false, errorMessage: null, pending: 1 });

  tasks.set(42, { status: "DONE", error: null });
  const second = settleRunDetails(first.details, tasks);
  assert.equal(runOutcome(second.details).success, true);
  // Nochmals abgleichen aendert nichts.
  assert.equal(settleRunDetails(second.details, tasks).changed, false);
});

test("settleRunDetails: gescheitert, verfallen oder geloescht zaehlt als Fehlschlag", () => {
  const failed = settleRunDetails([LAMPE], new Map([[41, { status: "FAILED", error: "Bridge nicht erreichbar" }]]));
  assert.equal(runOutcome(failed.details).errorMessage, "Lampe Eingang: Hub: Bridge nicht erreichbar");
  const expired = settleRunDetails([LAMPE], new Map([[41, { status: "FAILED", error: "abgelaufen" }]]));
  assert.equal(runOutcome(expired.details).errorMessage, "Lampe Eingang: Hub hat den Auftrag nicht rechtzeitig abgeholt");
  const gone = settleRunDetails([LAMPE], new Map());
  assert.equal(runOutcome(gone.details).success, false);
  assert.match(runOutcome(gone.details).errorMessage ?? "", /nicht mehr vorhanden/);
  // Offen bleibt offen.
  assert.equal(settleRunDetails([LAMPE], new Map([[41, { status: "PENDING", error: null }]])).changed, false);
});

test("runState: Anzeige auf der Regel-Seite", () => {
  assert.equal(runState({ success: true, details: [TOR] }), "ok");
  assert.equal(runState({ success: false, details: [TOR, LAMPE] }), "uebergeben");
  assert.equal(runState({ success: false, details: [{ ...TOR, ok: false, error: "x" }, LAMPE] }), "fehler");
  // Aeltere Laeufe ohne Details.
  assert.equal(runState({ success: false }), "fehler");
});

test("switchedFollowUp: Folgeregeln nach dem Ergebnis eines Hue-Auftrags", () => {
  const createdAt = new Date("2026-11-28T18:00:00.000Z");
  const task = (payload: unknown, type = "HUE_SET") => ({ type, payload, createdAt });
  const at = (ms: number) => new Date(createdAt.getTime() + ms);
  const ok = { success: true, wasOpen: true };
  const marked = { deviceId: 5, bridgeId: "b1", lightId: "3", on: true, switched: { action: "open", depth: 0 } };
  assert.deepEqual(switchedFollowUp(task(marked), ok, at(3_000)), { deviceId: 5, action: "open", depth: 0 });
  assert.deepEqual(switchedFollowUp(task({ ...marked, switched: { action: "deactivate", depth: 1 } }), ok, at(3_000)), {
    deviceId: 5,
    action: "deactivate",
    depth: 1,
  });
  // Rechtzeitig: bis 10 Minuten nach dem Anlegen.
  assert.notEqual(switchedFollowUp(task(marked), ok, at(SWITCHED_FOLLOW_UP_MAX_MS)), null);
  assert.equal(switchedFollowUp(task(marked), ok, at(SWITCHED_FOLLOW_UP_MAX_MS + 1)), null);
  // Gescheitert oder schon erledigt (zweite Meldung): nichts.
  assert.equal(switchedFollowUp(task(marked), { success: false, wasOpen: true }, at(1_000)), null);
  assert.equal(switchedFollowUp(task(marked), { success: true, wasOpen: false }, at(1_000)), null);
  // Aelterer Auftrag ohne Markierung: Seine Folgeregeln liefen schon bei der Uebergabe.
  const plain = { deviceId: 5, bridgeId: "b1", lightId: "3", on: true };
  assert.equal(switchedFollowUp(task(plain), ok, at(1_000)), null);
  // Andere Auftraege und Unbrauchbares
  assert.equal(switchedFollowUp(task(marked, "CAMERA_SCENE"), ok, at(1_000)), null);
  assert.equal(switchedFollowUp(task(null), ok, at(1_000)), null);
  assert.equal(switchedFollowUp(task({ ...marked, deviceId: "5x" }), ok, at(1_000)), null);
  assert.equal(switchedFollowUp(task({ ...marked, switched: { action: "Auf!", depth: 0 } }), ok, at(1_000)), null);
  assert.equal(switchedFollowUp(task({ ...marked, switched: { action: "open", depth: -1 } }), ok, at(1_000)), null);
  assert.equal(switchedFollowUp(task({ ...marked, switched: { action: "open" } }), ok, at(1_000)), null);
});

test("ownHubTasks: je Lauf nur Auftraege seines Mandanten", () => {
  const tasks = [
    { id: 1, accountId: 1, status: "DONE", error: null },
    { id: 2, accountId: 2, status: "FAILED", error: "Bridge nicht erreichbar" },
  ];
  const own = ownHubTasks(tasks, 1);
  assert.deepEqual([...own.keys()], [1]);
  // Ein Lauf, der den Auftrag eines anderen Mandanten nennt, sieht dessen Stand nicht.
  const { details } = settleRunDetails([{ actionId: 3, target: "Licht", pending: true, hubTaskId: 2 }], own);
  assert.equal(details[0].ok, false);
  assert.equal(details[0].error, "Hub-Auftrag nicht mehr vorhanden");
  assert.equal(JSON.stringify(details).includes("Bridge"), false);
});

test("sanitizeHubRunDetails: nur die Felder des Hubs, gekuerzt und begrenzt", () => {
  const clean = sanitizeHubRunDetails([
    { actionId: 21, key: "DEVICE:9:close", kind: "DEVICE", target: "Rolltor", ok: true, ms: 812.4 },
    // Felder, die nur die Cloud setzt, fallen weg: Ein Hub-Lauf haengt an keinem Auftrag.
    { actionId: 22, kind: "DEVICE", target: "Licht", ok: false, error: "Zeitüberschreitung", pending: true, hubTaskId: 9, deviceId: 4, extra: { a: 1 } },
    { actionId: -1, key: 5, kind: "x".repeat(100), target: "t".repeat(500), ok: "ja", error: "e".repeat(2000), ms: -5 },
    null,
    "kaputt",
    [1, 2],
  ]);
  assert.deepEqual(clean[0], { actionId: 21, key: "DEVICE:9:close", kind: "DEVICE", target: "Rolltor", ok: true, ms: 812 });
  assert.deepEqual(clean[1], { actionId: 22, kind: "DEVICE", target: "Licht", ok: false, error: "Zeitüberschreitung" });
  assert.deepEqual(clean[2], { kind: "x".repeat(40), target: "t".repeat(200), ok: false, error: "e".repeat(500) });
  assert.equal(clean.length, 3);
  assert.deepEqual(pendingHubTaskIds(clean), []);
  assert.deepEqual(sanitizeHubRunDetails({ actionId: 1 }), []);
  assert.equal(sanitizeHubRunDetails(Array.from({ length: 500 }, (_, i) => ({ actionId: i + 1, ok: true }))).length, HUB_RUN_DETAILS_MAX);
});
