import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHELLY_GEN_CACHE_MS,
  genCacheFresh,
  retryable,
  shellyNotSent,
  shellyAction,
  shellyErrorKind,
  type ShellyAction,
  type ShellyErrorKind,
} from "./shelly-rules.js";

test("shellyAction: an mit Selbstabschaltung ist ein Impuls", () => {
  assert.equal(shellyAction(true), "on");
  assert.equal(shellyAction(true, 0), "on");
  assert.equal(shellyAction(true, null), "on");
  assert.equal(shellyAction(true, 3), "pulse");
  assert.equal(shellyAction(false), "off");
  // Ausschalten mit Zeitangabe bleibt aus (die Zeit gilt nur beim Einschalten).
  assert.equal(shellyAction(false, 30), "off");
  assert.equal(shellyAction("toggle"), "toggle");
  assert.equal(shellyAction("toggle", 3), "toggle");
});

test("retryable: aus nach Netzfehler oder Zeitlimit, an nur ohne Verbindung, sonst nie", () => {
  const actions: ShellyAction[] = ["on", "off", "toggle", "pulse"];
  const kinds: ShellyErrorKind[] = ["network", "timeout", "http", "auth", "other"];
  const yes: string[] = [];
  for (const notSent of [false, true]) {
    for (const a of actions) for (const k of kinds) if (retryable(a, k, notSent)) yes.push(`${a}/${k}${notSent ? "/nicht gesendet" : ""}`);
  }
  assert.deepEqual(yes, [
    "off/network",
    "off/timeout",
    "on/network/nicht gesendet",
    "on/timeout/nicht gesendet",
    "off/network/nicht gesendet",
    "off/timeout/nicht gesendet",
  ]);
});

test("shellyNotSent: nur wenn die Verbindung nicht zustande kam", () => {
  const fetchFailed = (cause: Record<string, string>) => Object.assign(new TypeError("fetch failed"), { cause });
  for (const code of ["ECONNREFUSED", "EHOSTUNREACH", "EHOSTDOWN", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"]) {
    assert.equal(shellyNotSent(fetchFailed({ code })), true, code);
  }
  assert.equal(shellyNotSent(fetchFailed({ name: "ConnectTimeoutError" })), true);
  // Abbruch oder Zeitlimit mitten in der Anfrage: vielleicht angekommen.
  for (const code of ["ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET"]) assert.equal(shellyNotSent(fetchFailed({ code })), false, code);
  assert.equal(shellyNotSent(Object.assign(new Error("x"), { name: "TimeoutError" })), false);
  assert.equal(shellyNotSent(new TypeError("fetch failed")), false);
  assert.equal(shellyNotSent(null), false);
});

test("shellyErrorKind: Zeitlimit, Netzfehler, HTTP-Status, Passwort", () => {
  const named = (name: string, message = "x") => Object.assign(new Error(message), { name });
  assert.equal(shellyErrorKind(named("TimeoutError")), "timeout");
  assert.equal(shellyErrorKind(named("AbortError")), "timeout");
  const fetchFailed = (code?: string) => Object.assign(new TypeError("fetch failed"), code ? { cause: { code } } : {});
  assert.equal(shellyErrorKind(fetchFailed("ECONNREFUSED")), "network");
  assert.equal(shellyErrorKind(fetchFailed("EHOSTUNREACH")), "network");
  assert.equal(shellyErrorKind(fetchFailed("ECONNRESET")), "network");
  assert.equal(shellyErrorKind(fetchFailed("ETIMEDOUT")), "timeout");
  assert.equal(shellyErrorKind(fetchFailed("UND_ERR_SOCKET")), "network");
  assert.equal(shellyErrorKind(fetchFailed()), "network");
  assert.equal(
    shellyErrorKind(Object.assign(new TypeError("fetch failed"), { cause: { name: "ConnectTimeoutError" } })),
    "timeout"
  );
  assert.equal(shellyErrorKind(new Error("HTTP 500")), "http");
  assert.equal(shellyErrorKind(new Error("HTTP 404")), "http");
  assert.equal(shellyErrorKind(new Error("Shelly-Passwort falsch")), "auth");
  assert.equal(shellyErrorKind(new Error("Shelly-Passwort abgelehnt (192.168.1.20) – kein Versuch")), "auth");
  assert.equal(shellyErrorKind(new Error("Shelly verlangt ein Passwort (HUB_SHELLY_PASSWORD fehlt)")), "auth");
  // Ungueltiges JSON in der Antwort: Das Geraet hat geantwortet, keine Wiederholung.
  assert.equal(shellyErrorKind(new SyntaxError("Unexpected token")), "other");
  assert.equal(shellyErrorKind(null), "other");
  assert.equal(shellyErrorKind("weg"), "other");
});

test("genCacheFresh: eine Stunde, Uhr zurueck gilt als abgelaufen", () => {
  const at = Date.UTC(2026, 10, 26, 9, 0, 0);
  assert.equal(genCacheFresh(undefined, at), false);
  assert.equal(genCacheFresh({ at }, at), true);
  assert.equal(genCacheFresh({ at }, at + SHELLY_GEN_CACHE_MS - 1), true);
  assert.equal(genCacheFresh({ at }, at + SHELLY_GEN_CACHE_MS), false);
  assert.equal(genCacheFresh({ at }, at - 1), false);
});
