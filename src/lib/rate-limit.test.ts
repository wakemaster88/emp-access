import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetRateLimits, publicLinkRateLimit, requestClientIp } from "./rate-limit";

function req(ip?: string): Request {
  const headers = new Headers();
  if (ip) headers.set("x-forwarded-for", `${ip}, 10.0.0.1`);
  return new Request("https://example.test/api", { headers });
}

beforeEach(() => _resetRateLimits());

test("requestClientIp: erste Adresse aus x-forwarded-for, sonst x-real-ip, sonst Platzhalter", () => {
  assert.equal(requestClientIp(req("203.0.113.5").headers), "203.0.113.5");
  assert.equal(requestClientIp(new Headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(requestClientIp(new Headers()), "-");
});

test("publicLinkRateLimit: Grenze gilt je Token und Endpunkt", () => {
  const opts = { limit: 3, windowMs: 60_000 };
  for (let i = 0; i < 3; i++) assert.equal(publicLinkRateLimit(req("203.0.113.5"), "tok-a", "s", opts), null);
  const blocked = publicLinkRateLimit(req("203.0.113.5"), "tok-a", "s", opts);
  assert.ok(blocked);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  // anderer Token und anderer Endpunkt zaehlen getrennt
  assert.equal(publicLinkRateLimit(req("203.0.113.5"), "tok-b", "s", opts), null);
  assert.equal(publicLinkRateLimit(req("203.0.113.5"), "tok-a", "t", opts), null);
});

test("publicLinkRateLimit: fremde IP bremst den Betrieb mit demselben Link nicht", () => {
  const opts = { limit: 2, windowMs: 60_000 };
  publicLinkRateLimit(req("198.51.100.9"), "tok", "s", opts);
  publicLinkRateLimit(req("198.51.100.9"), "tok", "s", opts);
  assert.ok(publicLinkRateLimit(req("198.51.100.9"), "tok", "s", opts));
  assert.equal(publicLinkRateLimit(req("203.0.113.5"), "tok", "s", opts), null);
});

test("publicLinkRateLimit: Standard reicht fuer mehrere Geraete hinter einer IP", () => {
  // 120 pro Minute je Token und IP
  for (let i = 0; i < 120; i++) assert.equal(publicLinkRateLimit(req("203.0.113.5"), "tok", "w"), null);
  assert.ok(publicLinkRateLimit(req("203.0.113.5"), "tok", "w"));
});
