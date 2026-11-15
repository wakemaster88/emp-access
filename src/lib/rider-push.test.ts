import { test } from "node:test";
import assert from "node:assert/strict";
import { isPushServiceUrl } from "./rider-push";

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
