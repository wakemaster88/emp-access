import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  isSnsCertUrl, isSnsSubscribeUrl, parseSesEvent, parseSnsMessage, snsStringToSign, verifySnsSignature, type SnsMessage,
} from "./sns";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();

function signed(m: Omit<SnsMessage, "Signature">, version = "2"): SnsMessage {
  const msg = { ...m, SignatureVersion: version, Signature: "" } as SnsMessage;
  const text = snsStringToSign(msg)!;
  msg.Signature = createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256").update(text).sign(privateKey, "base64");
  return msg;
}

const BASE = {
  Type: "Notification",
  MessageId: "m-1",
  TopicArn: "arn:aws:sns:eu-central-1:123456789012:newsletter",
  Message: "{}",
  Timestamp: "2026-11-27T12:00:00.000Z",
  SignatureVersion: "2",
  SigningCertURL: "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem",
};

test("verifySnsSignature: echte Signatur gilt, veränderte Meldung nicht", () => {
  for (const v of ["1", "2"]) {
    const m = signed(BASE, v);
    assert.ok(verifySnsSignature(m, PUB));
    assert.equal(verifySnsSignature({ ...m, Message: '{"x":1}' }, PUB), false);
    assert.equal(verifySnsSignature({ ...m, TopicArn: "arn:aws:sns:eu-central-1:999:fremd" }, PUB), false);
  }
});

test("verifySnsSignature: Bestätigung einer Verbindung", () => {
  const m = signed({
    ...BASE,
    Type: "SubscriptionConfirmation",
    Token: "tok",
    SubscribeURL: "https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok",
  });
  assert.ok(verifySnsSignature(m, PUB));
});

test("Zertifikats- und Bestätigungsadressen nur von SNS", () => {
  assert.ok(isSnsCertUrl(BASE.SigningCertURL));
  assert.ok(!isSnsCertUrl("https://sns.eu-central-1.amazonaws.com.evil.com/x.pem"));
  assert.ok(!isSnsCertUrl("http://sns.eu-central-1.amazonaws.com/x.pem"));
  assert.ok(!isSnsCertUrl("https://sns.eu-central-1.amazonaws.com/x.txt"));
  assert.ok(isSnsSubscribeUrl("https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription"));
  assert.ok(!isSnsSubscribeUrl("https://example.com/?Action=ConfirmSubscription"));
});

test("parseSnsMessage: Pflichtfelder", () => {
  const m = signed(BASE);
  assert.ok(parseSnsMessage(m));
  assert.equal(parseSnsMessage({ ...m, Signature: undefined }), null);
  assert.equal(parseSnsMessage("x"), null);
});

test("parseSesEvent: dauerhafter Rückläufer mit Tags", () => {
  const e = parseSesEvent(
    JSON.stringify({
      eventType: "Bounce",
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        bouncedRecipients: [{ emailAddress: "Gibt.Es.Nicht@Example.com", diagnosticCode: "550 5.1.1 user unknown" }],
        timestamp: "2026-11-27T12:01:00.000Z",
      },
      mail: { messageId: "ses-1", destination: ["gibt.es.nicht@example.com"], tags: { acc: ["1"], send: ["55"] } },
    }),
  );
  assert.equal(e?.kind, "bounce");
  assert.equal(e?.permanent, true);
  assert.deepEqual(e?.recipients, ["gibt.es.nicht@example.com"]);
  assert.deepEqual(e?.tags, { acc: "1", send: "55" });
  assert.equal(e?.messageId, "ses-1");
  assert.match(e?.detail ?? "", /user unknown/);
});

test("parseSesEvent: Beschwerde und Zustellung, auch als Identitäts-Meldung", () => {
  const c = parseSesEvent(
    JSON.stringify({ notificationType: "Complaint", complaint: { complainedRecipients: [{ emailAddress: "a@b.de" }] }, mail: { messageId: "x" } }),
  );
  assert.equal(c?.kind, "complaint");
  assert.deepEqual(c?.recipients, ["a@b.de"]);
  const d = parseSesEvent(JSON.stringify({ eventType: "Delivery", delivery: { recipients: ["a@b.de"] }, mail: { messageId: "y" } }));
  assert.equal(d?.kind, "delivery");
  assert.equal(parseSesEvent("kein json"), null);
});
