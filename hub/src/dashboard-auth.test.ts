import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AttemptLimiter,
  checkCookieValue,
  clientKey,
  cookieValueFor,
  dashboardAccessMode,
} from "./dashboard-auth.js";

const TOKEN = "beispiel-token-nur-fuer-tests";

test("Cookie-Wert: abgeleitet, stabil, ohne Token im Klartext", () => {
  const v = cookieValueFor(TOKEN);
  assert.equal(v, cookieValueFor(TOKEN));
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!v.includes(TOKEN));
  // Anderes Token = anderer Wert: Token wechseln meldet weiter alle ab.
  assert.notEqual(cookieValueFor(`${TOKEN}x`), v);
});

test("Cookie: neuer Wert und altes Klartext-Cookie gelten, sonst nichts", () => {
  assert.equal(checkCookieValue(cookieValueFor(TOKEN), TOKEN), "derived");
  assert.equal(checkCookieValue(TOKEN, TOKEN), "legacy");
  assert.equal(checkCookieValue("falsch", TOKEN), null);
  assert.equal(checkCookieValue("", TOKEN), null);
  assert.equal(checkCookieValue(cookieValueFor("altes-token"), TOKEN), null);
  assert.equal(checkCookieValue(TOKEN, ""), null);
});

test("clientKey: IPv4 aus IPv6-Schreibweise", () => {
  assert.equal(clientKey("::ffff:192.168.10.20"), "192.168.10.20");
  assert.equal(clientKey("192.168.10.20"), "192.168.10.20");
  assert.equal(clientKey("FE80::1"), "fe80::1");
  assert.equal(clientKey(undefined), "?");
});

const OPTS = { maxFailures: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000, maxEntries: 1000 };

test("20 Fehlversuche in 15 min sperren die Adresse fuer 15 min", () => {
  const l = new AttemptLimiter(OPTS);
  const t0 = 1_000_000;
  for (let i = 0; i < 19; i++) assert.equal(l.recordFailure("a", `v${i}`, t0 + i), false);
  assert.equal(l.blockedFor("a", t0 + 19), 0);
  assert.equal(l.recordFailure("a", "v19", t0 + 19), true);
  assert.ok(l.blockedFor("a", t0 + 20) > 0);
  assert.equal(l.blockedFor("b", t0 + 20), 0, "andere Adresse bleibt frei");
  assert.ok(l.blockedFor("a", t0 + 19 + 15 * 60_000 - 1) > 0);
  assert.equal(l.blockedFor("a", t0 + 19 + 15 * 60_000), 0);
  // Nach Ablauf faengt die Zaehlung neu an.
  assert.equal(l.recordFailure("a", "w", t0 + 19 + 15 * 60_000), false);
});

test("Fehlversuche ausserhalb des Fensters zaehlen nicht zusammen", () => {
  const l = new AttemptLimiter(OPTS);
  for (let i = 0; i < 19; i++) l.recordFailure("a", `v${i}`, i);
  // 15 min nach dem ersten Fehlversuch beginnt ein neues Fenster.
  assert.equal(l.recordFailure("a", "neu", 15 * 60_000), false);
  assert.equal(l.blockedFor("a", 15 * 60_000 + 1), 0);
});

test("gleitendes Fenster: Fehlversuche an der Fenstergrenze zaehlen zusammen", () => {
  const l = new AttemptLimiter(OPTS);
  const min = 60_000;
  l.recordFailure("a", "erster", 0);
  for (let i = 0; i < 18; i++) assert.equal(l.recordFailure("a", `v${i}`, 14 * min + i), false);
  // Der erste Fehlversuch faellt heraus, die 18 spaeteren zaehlen weiter.
  assert.equal(l.recordFailure("a", "w0", 15 * min), false);
  assert.equal(l.recordFailure("a", "w1", 15 * min + 1), true);
});

test("derselbe abgelehnte Wert (veraltetes Cookie im offenen Tab) zaehlt nur einmal", () => {
  const l = new AttemptLimiter(OPTS);
  for (let i = 0; i < 500; i++) assert.equal(l.recordFailure("a", "altes-cookie", i * 1000), false);
  assert.equal(l.blockedFor("a", 500_000), 0);
  // Abwechselnd mit getippten Werten zaehlt das alte Cookie ebenfalls nicht erneut.
  for (let i = 0; i < 5; i++) {
    l.recordFailure("a", `tippfehler${i}`, 500_000 + i);
    l.recordFailure("a", "altes-cookie", 500_000 + i);
  }
  assert.equal(l.blockedFor("a", 500_010), 0);
  // Danach getippte Werte zaehlen weiter einzeln (5 + 1 + 13 = 19, der 20. sperrt).
  for (let i = 0; i < 13; i++) assert.equal(l.recordFailure("a", `t${i}`, 500_020 + i), false);
  assert.equal(l.recordFailure("a", "t18", 500_100), true);
});

test("geratene Werte zaehlen auch, wenn sie sich wiederholen, sobald sie aus der Merkliste fallen", () => {
  const l = new AttemptLimiter(OPTS);
  let blocked = false;
  for (let i = 0; i < 40 && !blocked; i++) blocked = l.recordFailure("a", `v${i % 10}`, i);
  assert.equal(blocked, true);
});

test("altes Cookie plus 19 geratene Werte sperren", () => {
  const l = new AttemptLimiter(OPTS);
  l.recordFailure("a", "altes-cookie", 0);
  for (let i = 0; i < 18; i++) assert.equal(l.recordFailure("a", `t${i}`, 1 + i), false);
  assert.equal(l.recordFailure("a", "t18", 100), true);
});

test("erfolgreiche Anmeldung loescht den Zaehler", () => {
  const l = new AttemptLimiter(OPTS);
  for (let i = 0; i < 19; i++) l.recordFailure("a", `v${i}`, i);
  l.clear("a");
  assert.equal(l.recordFailure("a", "x", 100), false);
  assert.equal(l.blockedFor("a", 101), 0);
});

test("Speicher begrenzt: aelteste Adresse faellt zuerst raus", () => {
  const l = new AttemptLimiter({ ...OPTS, maxFailures: 3, maxEntries: 3 });
  l.recordFailure("a", "x", 1);
  l.recordFailure("b", "x", 2);
  l.recordFailure("c", "x", 3);
  l.recordFailure("a", "y", 4); // a zuletzt geaendert
  l.recordFailure("b", "y", 5); // b zuletzt geaendert, c ist jetzt die aelteste
  l.recordFailure("d", "x", 6); // c faellt raus
  assert.equal(l.size, 3);
  assert.equal(l.recordFailure("a", "z", 7), true, "a hat seine Zaehlung behalten");
  assert.equal(l.recordFailure("c", "y", 8), false, "c faengt neu an");
  assert.equal(l.recordFailure("c", "z", 9), false);
  const big = new AttemptLimiter(OPTS);
  for (let i = 0; i < 5000; i++) big.recordFailure(`10.0.${i >> 8}.${i & 255}`, "x", i);
  assert.equal(big.size, 1000);
});

test("Zugriffsart aus Bind-Adresse und Token", () => {
  assert.equal(dashboardAccessMode("127.0.0.1", ""), "local");
  assert.equal(dashboardAccessMode("127.0.0.1", TOKEN), "local");
  assert.equal(dashboardAccessMode("localhost", ""), "local");
  assert.equal(dashboardAccessMode("0.0.0.0", TOKEN), "lan-token");
  assert.equal(dashboardAccessMode("0.0.0.0", ""), "lan-open");
  assert.equal(dashboardAccessMode("192.168.10.5", ""), "lan-open");
});
