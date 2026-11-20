import { test } from "node:test";
import assert from "node:assert/strict";
import { awardPushText, isPushServiceUrl } from "./rider-push";

test("isPushServiceUrl: nur die Push-Dienste der Browser", () => {
  assert.equal(isPushServiceUrl("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(isPushServiceUrl("https://updates.push.services.mozilla.com/wpush/v2/abc"), true);
  assert.equal(isPushServiceUrl("https://web.push.apple.com/abc"), true);
  assert.equal(isPushServiceUrl("https://db5p.notify.windows.com/w/?token=abc"), true);
  assert.equal(isPushServiceUrl("http://fcm.googleapis.com/fcm/send/abc"), false);
  assert.equal(isPushServiceUrl("https://fcm.googleapis.com.evil.example/x"), false);
  assert.equal(isPushServiceUrl("https://evilpush.apple.com/x"), false);
  assert.equal(isPushServiceUrl("https://fcm.googleapis.com:8443/x"), false);
  assert.equal(isPushServiceUrl("https://user@fcm.googleapis.com/x"), false);
  assert.equal(isPushServiceUrl("https://localhost/x"), false);
  assert.equal(isPushServiceUrl("kein link"), false);
});

test("awardPushText: für die Person selbst und für die Eltern", () => {
  assert.deepEqual(awardPushText("Hooked", "Ein Eis nach Wahl"), {
    title: "Award freigeschaltet: Hooked",
    body: "Dein Gutschein wartet in der App: Ein Eis nach Wahl",
  });
  assert.deepEqual(awardPushText("Hooked", null), { title: "Award freigeschaltet: Hooked", body: "Schau ihn dir in der App an." });
  assert.deepEqual(awardPushText("Hooked", "Ein Eis nach Wahl", "Mia"), {
    title: "Award für Mia: Hooked",
    body: "Der Gutschein wartet in der App: Ein Eis nach Wahl",
  });
});
