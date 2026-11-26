import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

interface Cand {
  type: string | null;
  address: string | null;
  port: number | null;
  state: string | null;
}

interface Rules {
  FIRST_TIMEOUT_MS: number;
  LATER_TIMEOUT_MS: number;
  OFFLINE_RETRY_MS: number;
  rtcTimeoutMs(attempts: number, kind?: string): number;
  tileRetryDelay(attempts: number, reachable: boolean | null | undefined, why?: string): number;
  reconnectNow(wasReachable: boolean | undefined, reachable: boolean): boolean;
  gatePlan(busyStarts: number[], queued: number, now: number, opts?: { max?: number; holdMs?: number }): { start: number; waitMs: number | null };
  pickCandidate(stats: unknown[]): Cand | null;
  boxStream(cam: { host: string | null; kind?: string }, streams: Array<{ name: string; host: string | null }>): string | null;
  shouldReload(o: { loadedUi: string | null; currentUi: string | null; view: string; dialogOpen: boolean; hidden: boolean }): string;
}

/** Laedt hub/src/ui/rtc-rules.js wie der Browser (klassisches Skript) in eine Sandbox. */
function loadRules(): Rules {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui", "rtc-rules.js");
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(`${readFileSync(file, "utf8")}\n;globalThis.__rules = RtcRules;`, sandbox);
  return sandbox.__rules as Rules;
}

const R = loadRules();
/** Objekte aus der Sandbox haben einen eigenen Prototyp; fuer deepEqual umkopieren. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test("Zeitlimit: erster Versuch 6 s, weitere 15 s, Mäher immer 15 s", () => {
  assert.equal(R.rtcTimeoutMs(0), 6000);
  assert.equal(R.rtcTimeoutMs(1), 15000);
  assert.equal(R.rtcTimeoutMs(5), 15000);
  assert.equal(R.rtcTimeoutMs(0, "MOWER"), 15000);
  assert.equal(R.rtcTimeoutMs(0, "REOLINK"), 6000);
});

test("Wartezeit vor dem nächsten Versuch: online 2, 4, 8, 15 s, offline 120 s, nach ICE-Zeitlimit sofort", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => R.tileRetryDelay(n, true)), [2000, 4000, 8000, 15000, 15000, 15000]);
  // Unbekannt gilt als online.
  assert.equal(R.tileRetryDelay(1, null), 2000);
  assert.equal(R.tileRetryDelay(1, undefined), 2000);
  // Als offline gemeldet: schon nach dem ersten Fehlschlag 120 s.
  assert.equal(R.tileRetryDelay(1, false), 120000);
  assert.equal(R.tileRetryDelay(7, false), 120000);
  // ICE-Zeitlimit bei erreichbarer Kamera: gleich neu; offline gilt weiter die lange Pause.
  assert.equal(R.tileRetryDelay(1, true, "ice-timeout"), 0);
  assert.equal(R.tileRetryDelay(3, true, "ice-timeout"), 0);
  assert.equal(R.tileRetryDelay(1, false, "ice-timeout"), 120000);
  assert.equal(R.tileRetryDelay(0, true), 0);
});

test("Kamera wieder erreichbar: sofort neu verbinden", () => {
  assert.equal(R.reconnectNow(false, true), true);
  assert.equal(R.reconnectNow(true, true), false);
  assert.equal(R.reconnectNow(undefined, true), false);
  assert.equal(R.reconnectNow(false, false), false);
});

test("Staffelung: höchstens 3 Kacheln beginnen gleichzeitig, jede gibt ihren Platz spätestens nach 2 s frei", () => {
  const t = 100_000;
  // 12 Kacheln öffnen gleichzeitig: 3 starten, nächster Blick in 2 s.
  assert.deepEqual(plain(R.gatePlan([], 12, t)), { start: 3, waitMs: 2000 });
  // 3 im Aufbau seit 500 ms: keine startet, nächster Blick in 1,5 s.
  assert.deepEqual(plain(R.gatePlan([t - 500, t - 500, t - 400], 9, t)), { start: 0, waitMs: 1500 });
  // Eine ist verbunden (aus der Liste), eine wartet: sie darf sofort.
  assert.deepEqual(plain(R.gatePlan([t - 500, t - 400], 1, t)), { start: 1, waitMs: null });
  // Nach 2 s gelten die Plätze als frei, auch ohne Verbindung.
  assert.deepEqual(plain(R.gatePlan([t - 2000, t - 2100, t - 2500], 4, t)), { start: 3, waitMs: 2000 });
  // Nichts wartet.
  assert.deepEqual(plain(R.gatePlan([t - 100], 0, t)), { start: 0, waitMs: null });
  // Plätze werden in 10 ms frei: nächster Blick frühestens in 50 ms (kein Takt im Millisekundenbereich).
  assert.deepEqual(plain(R.gatePlan([t - 1990, t - 1995, t - 1999], 2, t)), { start: 0, waitMs: 50 });
  assert.deepEqual(plain(R.gatePlan([t - 1900, t - 1990, t - 1000], 2, t)), { start: 0, waitMs: 50 });
  assert.deepEqual(plain(R.gatePlan([t - 1940, t - 100, t - 100], 2, t)), { start: 0, waitMs: 60 });
});

test("Kandidat aus getStats: gewählter Weg, sonst der zuletzt geprüfte", () => {
  const remote = (id: string, address: string, type = "host") => ({ id, type: "remote-candidate", candidateType: type, address, port: 8555 });
  const selected = R.pickCandidate([
    { id: "T1", type: "transport", selectedCandidatePairId: "P2" },
    { id: "P1", type: "candidate-pair", state: "failed", remoteCandidateId: "R1" },
    { id: "P2", type: "candidate-pair", state: "succeeded", nominated: true, remoteCandidateId: "R2" },
    remote("R1", "127.0.0.1"),
    remote("R2", "192.168.1.121"),
  ]);
  assert.deepEqual(plain(selected), { type: "host", address: "192.168.1.121", port: 8555, state: "succeeded" });

  // ICE checking (Safari): kein gewählter Weg, der zuletzt geprüfte Kandidat zählt.
  const checking = R.pickCandidate([
    { id: "T1", type: "transport" },
    { id: "P1", type: "candidate-pair", state: "in-progress", remoteCandidateId: "R1", lastPacketSentTimestamp: 10, requestsSent: 3 },
    { id: "P2", type: "candidate-pair", state: "in-progress", remoteCandidateId: "R2", lastPacketSentTimestamp: 20, requestsSent: 2 },
    { id: "P3", type: "candidate-pair", state: "failed", remoteCandidateId: "R1", lastPacketSentTimestamp: 30 },
    remote("R1", "127.0.0.1"),
    { id: "R2", type: "remote-candidate", candidateType: "host", ip: "192.168.20.5", port: 8555 },
  ]);
  assert.deepEqual(plain(checking), { type: "host", address: "192.168.20.5", port: 8555, state: "in-progress" });

  // Der Weg aus dem Transport geht vor, auch vor einem anderen nominierten Paar.
  const viaTransport = R.pickCandidate([
    { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
    { id: "P1", type: "candidate-pair", state: "succeeded", remoteCandidateId: "R1" },
    { id: "P2", type: "candidate-pair", state: "succeeded", nominated: true, selected: true, remoteCandidateId: "R2" },
    remote("R1", "192.168.1.121"),
    remote("R2", "127.0.0.1"),
  ]);
  assert.equal(viaTransport?.address, "192.168.1.121");
  // Transport nennt ein unbekanntes Paar: weiter mit selected.
  const selectedFlag = R.pickCandidate([
    { id: "T1", type: "transport", selectedCandidatePairId: "fehlt" },
    { id: "P1", type: "candidate-pair", state: "succeeded", nominated: true, remoteCandidateId: "R1", lastPacketSentTimestamp: 50 },
    { id: "P2", type: "candidate-pair", state: "succeeded", selected: true, remoteCandidateId: "R2", lastPacketSentTimestamp: 10 },
    remote("R1", "127.0.0.1"),
    remote("R2", "192.168.1.121"),
  ]);
  assert.equal(selectedFlag?.address, "192.168.1.121");
  // Ohne Transport und selected: das nominierte, erfolgreiche Paar vor einem später geprüften.
  const nominated = R.pickCandidate([
    { id: "P1", type: "candidate-pair", state: "succeeded", nominated: true, remoteCandidateId: "R1", lastPacketSentTimestamp: 10 },
    { id: "P2", type: "candidate-pair", state: "in-progress", nominated: true, remoteCandidateId: "R2", lastPacketSentTimestamp: 50 },
    { id: "P3", type: "candidate-pair", state: "in-progress", remoteCandidateId: "R2", lastPacketSentTimestamp: 60 },
    remote("R1", "192.168.1.121"),
    remote("R2", "127.0.0.1"),
  ]);
  assert.deepEqual(plain(nominated), { type: "host", address: "192.168.1.121", port: 8555, state: "succeeded" });

  assert.equal(R.pickCandidate([]), null);
  assert.equal(R.pickCandidate([{ id: "P1", type: "candidate-pair", state: "waiting", remoteCandidateId: "fehlt" }]), null);
});

test("Personen-Boxen aus dem Sub-Stream, Hauptstream nur ohne Sub", () => {
  const cam = { host: "192.168.1.10", kind: "REOLINK" };
  const both = [
    { name: "cam-halle_main", host: "192.168.1.10" },
    { name: "cam-halle_sub", host: "192.168.1.10" },
    { name: "cam-shop_sub", host: "192.168.1.11" },
  ];
  assert.equal(R.boxStream(cam, both), "cam-halle_sub");
  assert.equal(R.boxStream(cam, [both[0]]), "cam-halle_main");
  assert.equal(R.boxStream(cam, [{ name: "cam-halle", host: "192.168.1.10" }, both[0]]), "cam-halle");
  // Reihenfolge der Liste egal: Sub vor ohne Endung vor Haupt.
  assert.equal(R.boxStream(cam, [{ name: "cam-halle", host: "192.168.1.10" }, both[1]]), "cam-halle_sub");
  assert.equal(R.boxStream(cam, [both[0], { name: "cam-halle", host: "192.168.1.10" }]), "cam-halle");
  assert.equal(R.boxStream({ host: "192.168.1.99" }, both), null);
  // DoorBird ohne passenden Host: Stream doorbird. Streams ohne Host passen nie.
  assert.equal(R.boxStream({ host: "192.168.1.30", kind: "DOORBIRD" }, [{ name: "doorbird", host: "192.168.1.31" }]), "doorbird");
  assert.equal(R.boxStream({ host: null }, [{ name: "mower_a_1_h264", host: null }]), null);
});

test("Neu laden nach Hub-Update: nur verdeckt und ohne offene Großansicht, sonst Hinweis", () => {
  const base = { loadedUi: "a1", currentUi: "a1", view: "zentrale", dialogOpen: false, hidden: true };
  assert.equal(R.shouldReload(base), "none");
  assert.equal(R.shouldReload({ ...base, currentUi: null }), "none");
  assert.equal(R.shouldReload({ ...base, loadedUi: null, currentUi: "b2" }), "none");
  // Neue Version, Tab verdeckt bzw. gerade wieder sichtbar: neu laden.
  assert.equal(R.shouldReload({ ...base, currentUi: "b2" }), "reload");
  // Neue Version, Großansicht oder Dialog offen: nur Hinweis.
  assert.equal(R.shouldReload({ ...base, currentUi: "b2", dialogOpen: true }), "hint");
  // Neue Version, jemand schaut gerade hin: nur Hinweis.
  assert.equal(R.shouldReload({ ...base, currentUi: "b2", hidden: false }), "hint");
  // Bereich mit Eingabefeldern: nie von selbst.
  assert.equal(R.shouldReload({ ...base, currentUi: "b2", view: "aktionen" }), "hint");
});
