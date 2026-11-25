import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverPush } from "./web-push";

const TARGET = { id: 1, endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "p", auth: "a" };

test("deliverPush ohne VAPID-Keys sendet nichts", async () => {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  try {
    assert.deepEqual(await deliverPush([TARGET], { title: "t", body: "b" }), { sent: 0, failed: 0, staleIds: [] });
  } finally {
    if (pub !== undefined) process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = pub;
    if (priv !== undefined) process.env.VAPID_PRIVATE_KEY = priv;
  }
});

test("deliverPush ohne Ziele sendet nichts", async () => {
  assert.deepEqual(await deliverPush([], { title: "t", body: "b" }), { sent: 0, failed: 0, staleIds: [] });
});

test("deliverPush laedt web-push beim Senden und zaehlt Fehler des Push-Dienstes", async () => {
  // Gueltiges, zufaellig erzeugtes Test-Schluesselpaar (kein echter Schluessel).
  const webpush = (await import("web-push")).default;
  const keys = webpush.generateVAPIDKeys();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  const original = webpush.sendNotification;
  let calls = 0;
  webpush.sendNotification = (async () => {
    calls++;
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  }) as typeof webpush.sendNotification;
  try {
    const r = await deliverPush([TARGET], { title: "t", body: "b" });
    assert.equal(calls, 1);
    assert.deepEqual(r, { sent: 0, failed: 0, staleIds: [1] });
  } finally {
    webpush.sendNotification = original;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  }
});
