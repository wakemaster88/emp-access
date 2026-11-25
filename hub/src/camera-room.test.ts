import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraRoomClosed, sentinelNightWindow, setCameraRoomClosed } from "./camera-room.js";

test("Betriebszustand ohne Wächter (Assistent aus): unbekannt", () => {
  setCameraRoomClosed(null);
  assert.equal(cameraRoomClosed(7), null);
});

test("Betriebszustand kommt vom Wächter; scheitert die Abfrage, ist er unbekannt", () => {
  setCameraRoomClosed((id) => (id === 7 ? false : id === 2 ? true : null));
  assert.equal(cameraRoomClosed(7), false);
  assert.equal(cameraRoomClosed(2), true);
  assert.equal(cameraRoomClosed(5), null);
  setCameraRoomClosed(() => {
    throw new Error("Raumdaten kaputt");
  });
  assert.equal(cameraRoomClosed(7), null);
  setCameraRoomClosed(null);
});

test("Nachtfenster wie beim Wächter: HUB_AGENT_SENTINEL_NIGHT, sonst 22-6", () => {
  assert.equal(sentinelNightWindow({}), "22-6");
  assert.equal(sentinelNightWindow({ HUB_AGENT_SENTINEL_NIGHT: " 21-7 " }), "21-7");
});
