import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanVoteIds,
  clampHoldMinutes,
  decideZone,
  isActiveRider,
  pickWinner,
  staffHoldUntil,
  tallyVotes,
  type ZoneForVote,
} from "./music-vote-rules";

const now = new Date("2026-07-12T14:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const options = [
  { id: 1, name: "Chill" },
  { id: 2, name: "Party" },
  { id: 3, name: "Rock" },
];

test("aktiv ist, wer in den letzten 2 Stunden gestartet ist", () => {
  assert.equal(isActiveRider(ago(5), now), true);
  assert.equal(isActiveRider(ago(120), now), true);
  assert.equal(isActiveRider(ago(121), now), false);
  assert.equal(isActiveRider(null, now), false);
});

test("tallyVotes zählt je Playlist und lässt fremde Stimmen weg", () => {
  const tally = tallyVotes(options, [{ playlistId: 2 }, { playlistId: 2 }, { playlistId: 3 }, { playlistId: 99 }]);
  assert.deepEqual(tally.map((t) => t.votes), [0, 2, 1]);
});

test("pickWinner: Mehrheit gewinnt, Gleichstand behält die laufende, sonst die vordere", () => {
  assert.equal(pickWinner(tallyVotes(options, []), 1), null);
  assert.equal(pickWinner(tallyVotes(options, [{ playlistId: 3 }, { playlistId: 3 }, { playlistId: 1 }]), 1), 3);
  const tie = tallyVotes(options, [{ playlistId: 2 }, { playlistId: 3 }]);
  assert.equal(pickWinner(tie, 3), 3);
  assert.equal(pickWinner(tie, 1), 2);
  assert.equal(pickWinner(tie, null), 2);
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
  staffChoiceAt: null,
  ...over,
});

test("decideZone wechselt nur laufende eigene Musik", () => {
  assert.deepEqual(decideZone(zone(), 2, 60, now), { kind: "switch", playlistId: 2 });
  assert.deepEqual(decideZone(zone(), 1, 60, now), { kind: "keep" });
  assert.deepEqual(decideZone(zone({ sourceKind: "STREAM" }), 1, 60, now), { kind: "switch", playlistId: 1 });
  assert.deepEqual(decideZone(zone(), null, 60, now), { kind: "idle", reason: "no-votes" });
  assert.deepEqual(decideZone(zone({ isPlaying: false }), 2, 60, now), { kind: "idle", reason: "not-playing" });
  assert.deepEqual(decideZone(zone({ externalActive: "AIRPLAY" }), 2, 60, now), { kind: "idle", reason: "external" });
  assert.deepEqual(decideZone(zone({ deviceId: null }), 2, 60, now), { kind: "idle", reason: "no-player" });
});

test("decideZone: Personal geht vor, danach gilt wieder die Mehrheit", () => {
  assert.deepEqual(decideZone(zone({ staffChoiceAt: ago(30) }), 2, 60, now), { kind: "idle", reason: "staff-hold" });
  assert.deepEqual(decideZone(zone({ staffChoiceAt: ago(90) }), 2, 60, now), { kind: "switch", playlistId: 2 });
  assert.deepEqual(decideZone(zone({ staffChoiceAt: ago(1) }), 2, 0, now), { kind: "switch", playlistId: 2 });
});

test("cleanVoteIds und clampHoldMinutes", () => {
  assert.deepEqual(cleanVoteIds([3, 9, 1, 3], [1, 2, 3]), [3, 1]);
  assert.deepEqual(cleanVoteIds([1, 2, 3], [1, 2, 3], 2), [1, 2]);
  assert.equal(clampHoldMinutes("abc"), 60);
  assert.equal(clampHoldMinutes(-5), 0);
  assert.equal(clampHoldMinutes(9999), 480);
});
