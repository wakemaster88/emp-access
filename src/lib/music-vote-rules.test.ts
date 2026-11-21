import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanVoteIds,
  currentOption,
  optionKey,
  parseOptionKey,
  clampHoldMinutes,
  decideZone,
  isActiveRider,
  pickWinner,
  roundDue,
  voteRound,
  staffHoldUntil,
  tallyVotes,
  type ZoneForVote,
} from "./music-vote-rules";

const now = new Date("2026-07-12T14:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const options = [
  { key: "p1", name: "Chill" },
  { key: "p2", name: "Party" },
  { key: "s3", name: "Radio Wave" },
];

test("aktiv ist, wer in den letzten 2 Stunden gestartet ist", () => {
  assert.equal(isActiveRider(ago(5), now), true);
  assert.equal(isActiveRider(ago(120), now), true);
  assert.equal(isActiveRider(ago(121), now), false);
  assert.equal(isActiveRider(null, now), false);
});

test("tallyVotes zählt je Playlist und lässt fremde Stimmen weg", () => {
  const tally = tallyVotes(options, [{ option: "p2" }, { option: "p2" }, { option: "s3" }, { option: "p99" }]);
  assert.deepEqual(tally.map((t) => t.votes), [0, 2, 1]);
  assert.deepEqual(tally.map((t) => t.kind), ["PLAYLIST", "PLAYLIST", "STREAM"]);
});

test("pickWinner: Mehrheit gewinnt, Gleichstand behält die laufende, sonst die vordere", () => {
  assert.equal(pickWinner(tallyVotes(options, []), "p1"), null);
  assert.equal(pickWinner(tallyVotes(options, [{ option: "s3" }, { option: "s3" }, { option: "p1" }]), "p1"), "s3");
  const tie = tallyVotes(options, [{ option: "p2" }, { option: "s3" }]);
  assert.equal(pickWinner(tie, "s3"), "s3");
  assert.equal(pickWinner(tie, "p1"), "p2");
  assert.equal(pickWinner(tie, null), "p2");
});

test("staffHoldUntil: Ruhezeit nach Wahl des Teams", () => {
  assert.equal(staffHoldUntil(null, 60, now), null);
  assert.equal(staffHoldUntil(ago(10), 0, now), null);
  assert.equal(staffHoldUntil(ago(61), 60, now), null);
  assert.equal(staffHoldUntil(ago(10), 60, now)?.toISOString(), "2026-07-12T14:50:00.000Z");
});

const zone = (over: Partial<ZoneForVote> = {}): ZoneForVote => ({
  isActive: true,
  deviceId: 7,
  isPlaying: true,
  externalActive: null,
  sourceKind: "PLAYLIST",
  playlistId: 1,
  streamId: null,
  staffChoiceAt: null,
  ...over,
});

test("decideZone wechselt nur laufende eigene Musik", () => {
  assert.deepEqual(decideZone(zone(), "p2", 60, now), { kind: "switch", option: "p2" });
  assert.deepEqual(decideZone(zone(), "p1", 60, now), { kind: "keep" });
  assert.deepEqual(decideZone(zone(), "s3", 60, now), { kind: "switch", option: "s3" });
  assert.deepEqual(decideZone(zone({ sourceKind: "STREAM", streamId: 3 }), "s3", 60, now), { kind: "keep" });
  assert.deepEqual(decideZone(zone({ sourceKind: "STREAM", streamId: 3 }), "p1", 60, now), { kind: "switch", option: "p1" });
  assert.deepEqual(decideZone(zone(), null, 60, now), { kind: "idle", reason: "no-votes" });
  assert.deepEqual(decideZone(zone({ isPlaying: false }), "p2", 60, now), { kind: "idle", reason: "not-playing" });
  assert.deepEqual(decideZone(zone({ externalActive: "AIRPLAY" }), "p2", 60, now), { kind: "idle", reason: "external" });
  assert.deepEqual(decideZone(zone({ deviceId: null }), "p2", 60, now), { kind: "idle", reason: "no-player" });
});

test("decideZone: Personal geht vor, danach gilt wieder die Mehrheit", () => {
  assert.deepEqual(decideZone(zone({ staffChoiceAt: ago(30) }), "p2", 60, now), { kind: "idle", reason: "staff-hold" });
  assert.deepEqual(decideZone(zone({ staffChoiceAt: ago(90) }), "p2", 60, now), { kind: "switch", option: "p2" });
  assert.deepEqual(decideZone(zone({ staffChoiceAt: ago(1) }), "p2", 0, now), { kind: "switch", option: "p2" });
});

test("cleanVoteIds und clampHoldMinutes", () => {
  assert.deepEqual(cleanVoteIds([3, 9, 1, 3], [1, 2, 3]), [3, 1]);
  assert.deepEqual(cleanVoteIds([1, 2, 3], [1, 2, 3], 2), [1, 2]);
  assert.equal(clampHoldMinutes("abc"), 60);
  assert.equal(clampHoldMinutes(-5), 0);
  assert.equal(clampHoldMinutes(9999), 480);
});

test("Optionen: Playlist und Webradio als Text", () => {
  assert.equal(optionKey("PLAYLIST", 4), "p4");
  assert.equal(optionKey("STREAM", 12), "s12");
  assert.deepEqual(parseOptionKey("s12"), { kind: "STREAM", id: 12 });
  assert.equal(parseOptionKey("x1"), null);
  assert.equal(parseOptionKey("p0"), null);
  assert.equal(currentOption({ isPlaying: true, sourceKind: "STREAM", playlistId: 1, streamId: 5 }), "s5");
  assert.equal(currentOption({ isPlaying: false, sourceKind: "PLAYLIST", playlistId: 1, streamId: null }), null);
  assert.deepEqual(cleanVoteIds(["s2", "p9", "p1"], ["p1", "s2"]), ["s2", "p1"]);
});

test("voteRound: Runden ab Mitternacht, Wechsel am Rundenende", () => {
  const day = new Date("2026-07-11T22:00:00Z"); // 00:00 Berlin (Sommerzeit)
  const at = new Date("2026-07-12T14:07:30Z"); // 16:07:30 Berlin
  const r = voteRound(at, day, 15)!;
  assert.equal(r.start.toISOString(), "2026-07-12T14:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-07-12T14:15:00.000Z");
  assert.equal(voteRound(at, day, 0), null);
  // Letzte Runde endet um Mitternacht.
  const late = voteRound(new Date("2026-07-12T21:50:00Z"), day, 60)!;
  assert.equal(late.end.toISOString(), "2026-07-12T22:00:00.000Z");
});

test("roundDue: einmal je Rundenbeginn, ohne Runden immer", () => {
  const round = { start: new Date("2026-07-12T14:00:00Z") };
  assert.equal(roundDue(null, null), true);
  assert.equal(roundDue(round, null), true);
  assert.equal(roundDue(round, new Date("2026-07-12T13:45:00Z")), true);
  assert.equal(roundDue(round, new Date("2026-07-12T14:00:00Z")), false);
});
