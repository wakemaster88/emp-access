import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { RIDER_CACHE_PREFIX, riderNeedsSync } from "./rider-local";

/** Lädt public/sw.js in eine Sandbox und gibt die Hilfsfunktionen des Kunden-App-Caches zurück. */
function loadServiceWorker() {
  const code = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  const sandbox: Record<string, unknown> = {
    self: { addEventListener() {}, location: { origin: "https://example.test" } },
    URL,
    Map,
    Headers,
    Response,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\n;globalThis.__sw = { riderCacheToken, isSignedOut, RIDER_CACHE };`, sandbox);
  return sandbox.__sw as {
    riderCacheToken: (pathname: string) => string | null;
    isSignedOut: (res: { redirected?: boolean; type?: string; status?: number } | null) => boolean;
    RIDER_CACHE: string;
  };
}

const TOKEN = "abcdefghijklmnopqrstuv";

test("Service Worker hält nur angemeldete Seiten der Kunden-App lokal vor", () => {
  const { riderCacheToken } = loadServiceWorker();
  assert.equal(riderCacheToken(`/app/${TOKEN}`), TOKEN);
  assert.equal(riderCacheToken(`/app/${TOKEN}/gutscheine/12`), TOKEN);
  assert.equal(riderCacheToken(`/app/${TOKEN}/rueckblick`), TOKEN);
  assert.equal(riderCacheToken(`/app/${TOKEN}/anmelden`), null);
  assert.equal(riderCacheToken(`/app/${TOKEN}/einrichten`), null);
  assert.equal(riderCacheToken(`/app/${TOKEN}/neu/42.1.schluessel`), null);
  assert.equal(riderCacheToken(`/app/${TOKEN}/manifest.webmanifest`), null);
  assert.equal(riderCacheToken("/app/familie/irgendeinlangerschluessel"), null);
  assert.equal(riderCacheToken("/app/mail/irgendeinlangerschluessel"), null);
  assert.equal(riderCacheToken("/app/kurz"), null);
  assert.equal(riderCacheToken("/app"), null);
  assert.equal(riderCacheToken("/dashboard"), null);
  assert.equal(riderCacheToken(`/beach/${TOKEN}`), TOKEN);
  assert.equal(riderCacheToken(`/beach/${TOKEN}/anmelden`), null);
  assert.equal(riderCacheToken("/beach"), null);
});

test("Umleitung oder fehlende Berechtigung gilt als abgemeldet", () => {
  const { isSignedOut } = loadServiceWorker();
  assert.equal(isSignedOut({ redirected: true, status: 200 }), true);
  assert.equal(isSignedOut({ type: "opaqueredirect", status: 0 }), true);
  assert.equal(isSignedOut({ status: 401 }), true);
  assert.equal(isSignedOut({ status: 200, type: "basic" }), false);
  assert.equal(isSignedOut(null), false);
});

test("Cache-Name im Service Worker passt zum Löschen beim Abmelden", () => {
  const { RIDER_CACHE } = loadServiceWorker();
  assert.ok(RIDER_CACHE.startsWith(RIDER_CACHE_PREFIX));
});

test("riderNeedsSync: frisch gerenderte Seite bleibt, alte oder fremde Uhrzeit lädt neu", () => {
  const now = 1_000_000_000;
  assert.equal(riderNeedsSync(now - 5_000, now, 15_000), false);
  assert.equal(riderNeedsSync(now - 20_000, now, 15_000), true);
  assert.equal(riderNeedsSync(0, now, 15_000), true);
  assert.equal(riderNeedsSync(Number.NaN, now, 15_000), true);
  assert.equal(riderNeedsSync(now + 60_000, now, 15_000), true);
});
