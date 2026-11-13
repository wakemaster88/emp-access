import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPasskeyName, relyingPartyFrom, suggestPasskeyName, webauthnUserId } from "./passkey-utils";
import { passkeyErrorMessage } from "./passkey-client";

function h(init: Record<string, string>) {
  return new Headers(init);
}

test("relyingPartyFrom: Host der Anfrage, https", () => {
  assert.deepEqual(relyingPartyFrom(h({ host: "access.example.de" }), {}), {
    rpID: "access.example.de",
    origin: "https://access.example.de",
  });
});

test("relyingPartyFrom: Vercel-Header haben Vorrang", () => {
  assert.deepEqual(
    relyingPartyFrom(h({ host: "intern", "x-forwarded-host": "app.example.de", "x-forwarded-proto": "https" }), {}),
    { rpID: "app.example.de", origin: "https://app.example.de" },
  );
});

test("relyingPartyFrom: localhost mit Port ueber http", () => {
  assert.deepEqual(relyingPartyFrom(h({ host: "localhost:3000" }), {}), {
    rpID: "localhost",
    origin: "http://localhost:3000",
  });
});

test("relyingPartyFrom: Umgebungsvariablen legen fest", () => {
  const rp = relyingPartyFrom(h({ host: "preview.vercel.app" }), {
    WEBAUTHN_RP_ID: "example.de",
    WEBAUTHN_ORIGIN: "https://app.example.de",
  });
  assert.deepEqual(rp, { rpID: "example.de", origin: "https://app.example.de" });
});

test("cleanPasskeyName kuerzt und lehnt Leeres ab", () => {
  assert.equal(cleanPasskeyName("  iPhone   von  Aaron "), "iPhone von Aaron");
  assert.equal(cleanPasskeyName("   "), null);
  assert.equal(cleanPasskeyName(42), null);
  assert.equal(cleanPasskeyName("x".repeat(100))?.length, 60);
});

test("suggestPasskeyName erkennt gaengige Geraete", () => {
  assert.equal(suggestPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)"), "iPhone");
  assert.equal(suggestPasskeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "Mac");
  assert.equal(suggestPasskeyName("Mozilla/5.0 (Linux; Android 15)"), "Android");
  assert.equal(suggestPasskeyName(null), "Passkey");
});

test("webauthnUserId ist stabil je Admin", () => {
  assert.deepEqual(webauthnUserId(7), webauthnUserId(7));
  assert.notDeepEqual(webauthnUserId(7), webauthnUserId(8));
});

test("passkeyErrorMessage: Abbruch zeigt nichts, eigene Fehler bleiben", () => {
  const abort = new Error("cancelled");
  abort.name = "NotAllowedError";
  assert.equal(passkeyErrorMessage(abort), null);
  const dup = new Error("dup");
  dup.name = "InvalidStateError";
  assert.match(passkeyErrorMessage(dup) ?? "", /schon als Passkey/);
  assert.equal(passkeyErrorMessage(new Error("Passwort ist falsch")), "Passwort ist falsch");
  assert.match(passkeyErrorMessage("x") ?? "", /nicht geklappt/);
});
