import { test } from "node:test";
import assert from "node:assert/strict";
import { SesError, classifySesError, sesErrorCode, sesErrorText } from "./ses";

test("sesErrorCode: aus Kopfzeile oder Antwort", () => {
  assert.equal(sesErrorCode("MessageRejected:http://internal.amazon.com/", null), "MessageRejected");
  assert.equal(sesErrorCode(null, { __type: "com.amazonaws#TooManyRequestsException" }), "TooManyRequestsException");
  assert.equal(sesErrorCode(null, null), "");
});

test("classifySesError: stoppen, wiederholen, Empfänger", () => {
  assert.equal(classifySesError(403, "InvalidClientTokenId"), "stop");
  assert.equal(classifySesError(429, "TooManyRequestsException"), "retry");
  assert.equal(classifySesError(503, ""), "retry");
  assert.equal(classifySesError(400, "MessageRejected"), "recipient");
});

test("sesErrorText: deutsche Sätze mit nächstem Schritt", () => {
  const e = (code: string, msg = "x") => new SesError(msg, code, 400, classifySesError(400, code));
  assert.match(sesErrorText(e("InvalidClientTokenId")), /^Zugangsdaten ungültig/);
  assert.match(sesErrorText(e("SignatureDoesNotMatch")), /^Zugangsdaten ungültig/);
  assert.match(sesErrorText(e("AccessDeniedException")), /Richtlinie/);
  assert.match(sesErrorText(e("MessageRejected", "Email address is not verified. The following identities failed")), /Sandkasten/);
  assert.equal(sesErrorText(e("MessageRejected", "Illegal address")), "Illegal address");
  assert.equal(sesErrorText(new Error("kaputt")), "kaputt");
});
