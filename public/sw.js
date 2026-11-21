/*
 * Service Worker von EMP Access.
 *
 *  - Offline-Fallback: Seitenaufrufe gehen immer ans Netz; ohne Verbindung
 *    erscheint /offline statt der Browser-Fehlerseite. Navigation Preload
 *    startet die Anfrage schon, waehrend der Service Worker noch aufwacht
 *    (spuerbar schnellerer Start der installierten App).
 *  - Statische Dateien (/_next/static, Icons, Manifest, Splash) kommen aus
 *    dem Cache und werden im Hintergrund aufgefrischt.
 *  - /api wird nie gecacht: alles dort ist personen- oder zeitbezogen.
 *  - Kunden-App (/app/<token>/…): Seiten kommen sofort aus einem lokalen
 *    Cache und werden dabei im Hintergrund vom Server erneuert (der Server
 *    bleibt fuehrend, die Seite selbst holt danach frische Daten, siehe
 *    src/components/rider/rider-sync.tsx). Nur angemeldete Seiten mit 200,
 *    hoechstens RIDER_MAX_ENTRIES Stueck und RIDER_MAX_AGE_MS alt. Leitet
 *    der Server zur Anmeldung um, fliegen die Seiten dieses Fahrers raus;
 *    beim Abmelden loescht die App den ganzen Cache.
 *  - Web-Push anzeigen, Klick oeffnet die passende Seite, abgelaufene Abos
 *    werden still erneuert.
 *
 *  - Neue Version: installiert sich sofort und uebernimmt alle Fenster; der
 *    Update-Hinweis (src/components/layout/update-prompt.tsx) laedt die Seite
 *    danach neu. SKIP_WAITING aus der Seite greift, falls er doch wartet.
 *
 * VERSION bei jeder Aenderung an dieser Datei hochzaehlen: alte Caches
 * werden beim Aktivieren weggeraeumt. Ebenso nach Migrationen, die alter
 * Code nicht lesen kann (z. B. neuer Enum-Wert): eine Seite aus dem Cache
 * bindet die App per Skew Protection an das alte Deployment, das dann an
 * der neuen Datenbank scheitert (20.11.2026, Awards mit ALL_TIME).
 */
const VERSION = "2026-11-21-playlist-abstimmung";
const STATIC_CACHE = `emp-static-${VERSION}`;
// Name muss zu RIDER_CACHE_PREFIX in src/lib/rider-local.ts passen (Abmelden loescht danach).
const RIDER_CACHE = `emp-rider-${VERSION}`;
const RIDER_MAX_ENTRIES = 40;
const RIDER_MAX_AGE_MS = 14 * 86_400_000;
/** Wird dieselbe Seite so kurz nach einer Cache-Antwort erneut geladen, geht es ans Netz (Neuladen, neuer Build). */
const RIDER_RELOAD_MS = 10_000;
const CACHED_AT = "x-emp-cached-at";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.json", "/icon-192.png", "/icon-512.png", "/apple-icon.png", "/logo.png", "/logo-dark.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("emp-") && k !== STATIC_CACHE && k !== RIDER_CACHE).map((k) => caches.delete(k))))
      .then(() => (self.registration.navigationPreload ? self.registration.navigationPreload.enable().catch(() => {}) : null))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/splash/") ||
    url.pathname === "/manifest.json" ||
    /\.(png|ico|svg|webp|woff2?|webmanifest)$/.test(url.pathname)
  );
}

/**
 * Token der Kunden-App, wenn der Pfad eine angemeldete Seite ist, die lokal
 * vorgehalten werden darf; sonst null. Anmelden/Einrichten/Neu festlegen, Manifest,
 * Mail- und Familien-Links bleiben aussen vor.
 */
function riderCacheToken(pathname) {
  const m = /^\/app\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const token = m[1];
  if (token === "familie" || token === "mail" || decodeURIComponent(token).length < 16) return null;
  const rest = m[2] || "";
  if (/^\/(anmelden|einrichten|neu)(\/|$)/.test(rest) || /\.[a-z]+$/i.test(rest)) return null;
  return token;
}

/** Leitet der Server von einer Fahrer-Seite weg (Anmeldung, Einrichten), ist die Sitzung dort vorbei. */
function isSignedOut(res) {
  if (!res) return false;
  if (res.redirected) return true;
  return res.type === "opaqueredirect" || res.status === 401 || res.status === 403;
}

const riderServedAt = new Map();

async function purgeRiderToken(token) {
  const cache = await caches.open(RIDER_CACHE);
  const prefix = `${self.location.origin}/app/${token}`;
  const keys = await cache.keys();
  await Promise.all(keys.filter((r) => r.url === prefix || r.url.startsWith(`${prefix}/`) || r.url.startsWith(`${prefix}?`)).map((r) => cache.delete(r)));
}

async function storeRider(cacheKey, res) {
  const type = res.headers.get("content-type") || "";
  if (!res.ok || res.redirected || res.status !== 200 || !type.includes("text/html")) return;
  const headers = new Headers(res.headers);
  headers.set(CACHED_AT, String(Date.now()));
  const body = await res.clone().blob();
  const cache = await caches.open(RIDER_CACHE);
  await cache.put(cacheKey, new Response(body, { status: 200, statusText: res.statusText, headers }));
  const keys = await cache.keys();
  // cache.keys() liefert in Einfuegereihenfolge: aelteste zuerst entfernen.
  const extra = keys.length - RIDER_MAX_ENTRIES;
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((r) => cache.delete(r)));
}

function riderNavigation(event, token) {
  const { request } = event;
  const url = new URL(request.url);
  url.hash = "";
  const cacheKey = url.toString();

  const network = (async () => {
    const preloaded = await Promise.resolve(event.preloadResponse).catch(() => null);
    const res = preloaded || (await fetch(request));
    if (isSignedOut(res)) await purgeRiderToken(token).catch(() => {});
    else if (res.status === 404) await caches.open(RIDER_CACHE).then((c) => c.delete(cacheKey)).catch(() => {});
    else await storeRider(cacheKey, res).catch(() => {});
    return res;
  })();

  return (async () => {
    const cache = await caches.open(RIDER_CACHE);
    const cached = await cache.match(cacheKey);
    const age = cached ? Date.now() - Number(cached.headers.get(CACHED_AT) || 0) : Infinity;
    const servedAt = riderServedAt.get(cacheKey) || 0;
    const fresh = cached && age < RIDER_MAX_AGE_MS && Date.now() - servedAt > RIDER_RELOAD_MS;
    if (cached && !fresh && age >= RIDER_MAX_AGE_MS) await cache.delete(cacheKey);
    if (fresh) {
      riderServedAt.set(cacheKey, Date.now());
      event.waitUntil(network.catch(() => null));
      return cached;
    }
    try {
      return await network;
    } catch {
      // Ohne Netz lieber den letzten Stand zeigen als die Offline-Seite.
      if (cached && age < RIDER_MAX_AGE_MS) return cached;
      throw new Error("offline");
    }
  })();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    const riderToken = riderCacheToken(url.pathname);
    if (riderToken) {
      event.respondWith(
        riderNavigation(event, riderToken).catch(async () => {
          const offline = await caches.match(OFFLINE_URL);
          return offline || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }),
      );
      return;
    }
    event.respondWith(
      (async () => {
        const preloaded = await Promise.resolve(event.preloadResponse).catch(() => null);
        return preloaded || fetch(request);
      })().catch(async () => {
        const offline = await caches.match(OFFLINE_URL);
        return offline || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const refresh = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(refresh);
          return cached;
        }
        const res = await refresh;
        return res || new Response("", { status: 504 });
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "EMP Access", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "EMP Access";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
    requireInteraction: !!payload.requireInteraction,
    // Klingel: laengeres Muster, damit man es in der Tasche merkt.
    vibrate: payload.requireInteraction ? [300, 150, 300, 150, 300] : [100, 50, 100],
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Bereits offenes Dashboard-Fenster fokussieren und dorthin navigieren.
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) return client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// Der Push-Dienst tauscht Abos gelegentlich aus (iOS nach Updates, FCM
// turnusmaessig). Ohne diese Erneuerung kaeme still keine Nachricht mehr an.
self.addEventListener("pushsubscriptionchange", (event) => {
  const old = event.oldSubscription;
  const key = old && old.options && old.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then((sub) => {
        const post = (url, body) =>
          fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
        // Das Abo gehoert entweder zum Dashboard oder zur Kunden-App; die
        // jeweils andere Stelle lehnt ab bzw. kennt die alte Adresse nicht.
        return Promise.all([
          post("/api/push", { action: "subscribe", subscription: sub.toJSON() }),
          post("/api/rider/push/renew", { oldEndpoint: old.endpoint, subscription: sub.toJSON() }),
        ]);
      })
      .catch(() => {}),
  );
});
