import assert from "node:assert/strict";
import { test } from "node:test";
import {
  followSignature,
  followStep,
  followTrackOrder,
  holdState,
  isHoldState,
  leaderTarget,
  titleMatches,
  type LeaderState,
} from "./audio-follow";

function leader(patch: Partial<LeaderState> = {}): LeaderState {
  return {
    isActive: true,
    online: true,
    isPlaying: true,
    externalActive: null,
    sourceKind: "PLAYLIST",
    streamUrl: null,
    playlistId: 7,
    ...patch,
  };
}

test("leaderTarget: nur eigene, gemeldete Musik der gefolgten Zone zählt", () => {
  assert.deepEqual(leaderTarget(leader()), { kind: "PLAYLIST", playlistId: 7 });
  assert.deepEqual(leaderTarget(leader({ sourceKind: "STREAM", streamUrl: "https://radio" })), {
    kind: "STREAM",
    url: "https://radio",
  });
  for (const patch of [
    { isPlaying: false },
    { online: false },
    { isActive: false },
    { externalActive: "AIRPLAY" },
    { sourceKind: "SILENCE" },
    { sourceKind: "STREAM", streamUrl: null },
    { playlistId: null },
  ]) {
    assert.deepEqual(leaderTarget(leader(patch)), { kind: "STOP" }, JSON.stringify(patch));
  }
});

test("followStep: Wechsel weitergeben, Gleiches nicht doppelt", () => {
  const play = { kind: "PLAYLIST", playlistId: 7 } as const;
  const stop = { kind: "STOP" } as const;
  assert.deepEqual(followStep(null, play), { send: play, nextState: "PLAYLIST:7", hold: false });
  assert.deepEqual(followStep(null, stop), { send: stop, nextState: "STOP", hold: false });
  assert.deepEqual(followStep("PLAYLIST:7", play), { send: null, nextState: "PLAYLIST:7", hold: false });
  assert.deepEqual(followStep("PLAYLIST:7", stop), { send: stop, nextState: "STOP", hold: false });
  const radio = { kind: "STREAM", url: "https://r" } as const;
  assert.deepEqual(followStep("PLAYLIST:7", radio), { send: radio, nextState: "STREAM:https://r", hold: false });
});

test("Direkt gesteuert: gilt, bis sich die gefolgte Zone ändert", () => {
  const play = { kind: "PLAYLIST", playlistId: 7 } as const;
  const held = holdState(play);
  assert.equal(held, "HOLD:PLAYLIST:7");
  assert.equal(isHoldState(held), true);
  assert.equal(isHoldState("STOP"), false);
  assert.equal(isHoldState(null), false);
  assert.deepEqual(followStep(held, play), { send: null, nextState: held, hold: true });
  assert.deepEqual(followStep(held, { kind: "STOP" }), { send: { kind: "STOP" }, nextState: "STOP", hold: false });
  assert.equal(followSignature({ kind: "STOP" }), "STOP");
});

test("titleMatches: Titel oder „Interpret - Titel“, ohne Groß/Klein", () => {
  assert.equal(titleMatches({ title: "Freed from Desire", artist: "Gala" }, "Gala - Freed from Desire"), true);
  assert.equal(titleMatches({ title: "Gala - Freed from Desire" }, "gala - freed  from desire"), true);
  assert.equal(titleMatches({ title: "Freed from Desire", artist: null }, "Gala - Freed from Desire"), false);
  assert.equal(titleMatches({ title: "A" }, "  "), false);
});

test("followTrackOrder: beginnt beim Titel der gefolgten Zone", () => {
  const tracks = ["A", "B", "C", "D"].map((title) => ({ title }));
  const titles = (list: { title: string }[]) => list.map((t) => t.title);
  assert.deepEqual(titles(followTrackOrder(tracks, "C", false)), ["C", "D", "A", "B"]);
  assert.deepEqual(titles(followTrackOrder(tracks, "X", false)), ["A", "B", "C", "D"]);
  assert.deepEqual(titles(followTrackOrder(tracks, null, false)), ["A", "B", "C", "D"]);
  const mixed = titles(followTrackOrder(tracks, "C", true, () => 0));
  assert.equal(mixed[0], "C");
  assert.deepEqual([...mixed].sort(), ["A", "B", "C", "D"]);
  assert.equal(titles(followTrackOrder(tracks, null, true, () => 0)).length, 4);
});
