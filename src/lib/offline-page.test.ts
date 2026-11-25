import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

/** Lädt public/sw.js in eine Sandbox und gibt die Angaben zur Offline-Seite zurück. */
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
  vm.runInContext(`${code}\n;globalThis.__sw = { OFFLINE_URL, PRECACHE };`, sandbox);
  return sandbox.__sw as { OFFLINE_URL: string; PRECACHE: string[] };
}

test("Offline-Seite ist eine statische Datei und wird beim Installieren vorab geladen", () => {
  const { OFFLINE_URL, PRECACHE } = loadServiceWorker();
  assert.equal(OFFLINE_URL, "/offline.html");
  assert.ok(PRECACHE.includes(OFFLINE_URL));
  const html = readFileSync(join(process.cwd(), "public", OFFLINE_URL), "utf8");
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="de">/);
  assert.match(html, /Keine Verbindung/);
  assert.match(html, /<a class="retry" href="">\s*<svg[\s\S]*?Erneut versuchen\s*<\/a>/);
});

test("Offline-Seite braucht ohne Netz keine weiteren Dateien", () => {
  const html = readFileSync(join(process.cwd(), "public/offline.html"), "utf8");
  assert.doesNotMatch(html, /<script/i, "kein Skript");
  assert.doesNotMatch(html, /<link\b/i, "keine nachgeladenen Stylesheets oder Icons");
  assert.doesNotMatch(html, /\bsrc=/i, "keine Bilder oder Skripte von außen");
  assert.doesNotMatch(html, /url\(/i, "keine Hintergrundbilder oder Schriften");
  assert.doesNotMatch(html, /@import/i);
  // Einziger Verweis: dieselbe Adresse neu laden.
  assert.deepEqual(html.match(/href="[^"]*"/g), ['href=""']);
});

/** Service Worker mit Attrappen für Netz und Cache; gibt die registrierten Ereignisse zurück. */
function runServiceWorker(store: Map<string, Response>) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const added: string[] = [];
  const cache = {
    addAll: async (urls: string[]) => {
      added.push(...urls);
    },
    match: async () => undefined,
    keys: async () => [],
    put: async () => {},
    delete: async () => true,
  };
  const sandbox: Record<string, unknown> = {
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
      location: { origin: "https://example.test" },
      skipWaiting: () => Promise.resolve(),
    },
    caches: {
      open: async () => cache,
      match: async (url: string) => store.get(url),
      keys: async () => [],
    },
    fetch: async () => {
      throw new TypeError("offline");
    },
    URL,
    Map,
    Headers,
    Response,
    Promise,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), sandbox);
  return { handlers, added };
}

async function navigateOffline(path: string, store: Map<string, Response>) {
  const { handlers } = runServiceWorker(store);
  let answer: Promise<Response> | null = null;
  handlers.fetch({
    request: { method: "GET", url: `https://example.test${path}`, mode: "navigate", headers: new Headers() },
    preloadResponse: Promise.resolve(undefined),
    respondWith: (p: Promise<Response>) => (answer = p),
    waitUntil: () => {},
  });
  assert.ok(answer, "Service Worker beantwortet die Navigation");
  return answer as Promise<Response>;
}

test("Ohne Netz zeigt der Service Worker die vorab geladene Offline-Seite", async () => {
  const { handlers, added } = runServiceWorker(new Map());
  let installing: Promise<unknown> | null = null;
  handlers.install({ waitUntil: (p: Promise<unknown>) => (installing = p) });
  await installing;
  assert.ok(added.includes("/offline.html"));

  const page = new Response("<!doctype html>offline", { headers: { "Content-Type": "text/html" } });
  const store = new Map([["/offline.html", page]]);
  assert.equal(await (await navigateOffline("/dashboard", store)).text(), "<!doctype html>offline");
  // Kunden-App ohne gespeicherte Kopie: ebenfalls die Offline-Seite.
  const rider = new Response("<!doctype html>offline", { headers: { "Content-Type": "text/html" } });
  assert.equal(
    await (await navigateOffline("/app/abcdefghijklmnopqrstuv", new Map([["/offline.html", rider]]))).text(),
    "<!doctype html>offline",
  );
});

test("Fehlt die Offline-Seite im Cache, kommt eine schlichte Textantwort", async () => {
  const res = await navigateOffline("/dashboard", new Map());
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "Offline");
});
