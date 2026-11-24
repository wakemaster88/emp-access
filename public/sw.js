/*
 * Service Worker von EMP Access.
 *
 *  - Offline-Fallback: Seitenaufrufe gehen immer ans Netz; ohne Verbindung
 *    erscheint /offline statt der Browser-Fehlerseite. Navigation Preload
 *    startet die Anfrage schon, waehrend der Service Worker noch aufwacht
 *    (spuerbar schnellerer Start der installierten App).
 *  - Statische Dateien (/_next/static, Icons, Manifest, Splash) kommen aus
 *    dem Cache. /_next/static traegt den Inhalt im Namen und wird nie neu
 *    geholt, alles andere im Hintergrund aufgefrischt. Hoechstens
 *    STATIC_MAX_ENTRIES Stueck, die aeltesten fliegen zuerst raus
 *    (die vorab geladenen Dateien bleiben).
 *  - /api wird nie gecacht: alles dort ist personen- oder zeitbezogen.
 *  - Kunden-App (/app/<token>/… und /beach/<token>/…): Seiten kommen sofort aus einem lokalen
 *    Cache (der Server bleibt fuehrend, die Seite selbst holt danach frische
 *    Daten, siehe src/components/rider/rider-sync.tsx). Die Kopie wird mit
 *    der Antwort des Navigation Preload erneuert, sonst erst ab
 *    RIDER_REFRESH_MS Alter im Hintergrund. Ohne Kopie geht die Antwort
 *    sofort an die Seite, gespeichert wird parallel. Antwortet der Server
 *    mit 5xx oder gar nicht, zeigt die App die Kopie. Nur angemeldete Seiten
 *    mit 200, hoechstens RIDER_MAX_ENTRIES Stueck und RIDER_MAX_AGE_MS alt.
 *    Leitet der Server zur Anmeldung um, fliegen die Seiten dieses Fahrers
 *    raus; beim Abmelden loescht die App den ganzen Cache.
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
const VERSION = "2026-11-24-tempo";
const STATIC_CACHE = `emp-static-${VERSION}`;
// Name muss zu RIDER_CACHE_PREFIX in src/lib/rider-local.ts passen (Abmelden loescht danach).
const RIDER_CACHE = `emp-rider-${VERSION}`;
const RIDER_MAX_ENTRIES = 40;
const RIDER_MAX_AGE_MS = 14 * 86_400_000;
/** Bei einem Cache-Treffer holt der Service Worker erst ab diesem Alter selbst eine neue Kopie. */
const RIDER_REFRESH_MS = 30 * 60_000;
const STATIC_MAX_ENTRIES = 200;
/** Wird dieselbe Seite so kurz nach einer Cache-Antwort erneut geladen, geht es ans Netz (Neuladen, neuer Build). */
const RIDER_RELOAD_MS = 10_000;
const CACHED_AT = "x-emp-cached-at";
const OFFLINE_URL = "/offline";
// Nur was ohne Netz gebraucht wird: die Offline-Seite und die App-Icons.
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/apple-icon.png"];

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
  const m = /^\/(?:app|beach)\/([^/]+)(\/.*)?$/.exec(pathname);
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
  // Ride Pass (/app) und Beach Pass (/beach) teilen die Anmeldung.
  const prefixes = ["app", "beach"].map((p) => `${self.location.origin}/${p}/${token}`);
  const keys = await cache.keys();
  const hit = (u) => prefixes.some((prefix) => u === prefix || u.startsWith(`${prefix}/`) || u.startsWith(`${prefix}?`));
  await Promise.all(keys.filter((r) => hit(r.url)).map((r) => cache.delete(r)));
}

/** Hintergrundarbeit an das Ereignis haengen; wirft nie (z. B. wenn das Ereignis schon vorbei ist). */
function keep(event, promise) {
  const p = Promise.resolve(promise).catch(() => {});
  try {
    event.waitUntil(p);
  } catch {
    // Ereignis schon beendet: die Arbeit laeuft trotzdem zu Ende, solange der Worker wach ist.
  }
}

/**
 * Haelt einen Cache bei hoechstens `max` Eintraegen; cache.keys() liefert die
 * aeltesten zuerst. Die vorab geladenen Dateien (PRECACHE, u. a. /offline)
 * bleiben immer und zaehlen nicht mit.
 */
async function trimCache(cache, max) {
  const keys = (await cache.keys()).filter((r) => !PRECACHE.includes(new URL(r.url).pathname));
  const extra = keys.length - max;
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((r) => cache.delete(r)));
}

/** Speichert eine Kopie der Antwort (`copy` ist schon geklont und gehoert nur dieser Funktion). */
async function storeRider(cacheKey, copy) {
  const type = copy.headers.get("content-type") || "";
  if (!copy.ok || copy.redirected || copy.status !== 200 || !type.includes("text/html")) return;
  const headers = new Headers(copy.headers);
  headers.set(CACHED_AT, String(Date.now()));
  const body = await copy.blob();
  const cache = await caches.open(RIDER_CACHE);
  await cache.put(cacheKey, new Response(body, { status: 200, statusText: copy.statusText, headers }));
  await trimCache(cache, RIDER_MAX_ENTRIES);
}

function riderNavigation(event, token) {
  const { request } = event;
  const url = new URL(request.url);
  url.hash = "";
  const cacheKey = url.toString();
  const preload = Promise.resolve(event.preloadResponse).catch(() => null);

  // Antwort vom Server: Cache parallel pflegen, die Antwort selbst sofort weitergeben.
  const handle = (res) => {
    try {
      if (isSignedOut(res)) keep(event, purgeRiderToken(token));
      else if (res.status === 404) keep(event, caches.open(RIDER_CACHE).then((c) => c.delete(cacheKey)));
      else if (res.status === 200 && !res.redirected) keep(event, storeRider(cacheKey, res.clone()));
    } catch {
      // Cache ist Beiwerk: die Seite bekommt ihre Antwort trotzdem.
    }
    return res;
  };
  // Mit `fetchAllowed` false nur die Antwort des Navigation Preload (die der Browser ohnehin holt).
  const network = async (fetchAllowed) => {
    const preloaded = await preload;
    if (preloaded) return handle(preloaded);
    if (!fetchAllowed) return null;
    return handle(await fetch(request));
  };

  return (async () => {
    let cache = null;
    let cached = null;
    try {
      cache = await caches.open(RIDER_CACHE);
      cached = (await cache.match(cacheKey)) || null;
    } catch {
      cached = null;
    }
    const age = cached ? Date.now() - Number(cached.headers.get(CACHED_AT) || 0) : Infinity;
    const servedAt = riderServedAt.get(cacheKey) || 0;
    const fresh = cached && age < RIDER_MAX_AGE_MS && Date.now() - servedAt > RIDER_RELOAD_MS;
    if (cached && !fresh && age >= RIDER_MAX_AGE_MS && cache) keep(event, cache.delete(cacheKey));
    if (fresh) {
      riderServedAt.set(cacheKey, Date.now());
      keep(event, network(age >= RIDER_REFRESH_MS));
      return cached;
    }
    try {
      const res = await network(true);
      // Serverfehler: lieber den letzten Stand zeigen als die Fehlerseite.
      if (res.status >= 500 && cached && age < RIDER_MAX_AGE_MS) return cached;
      return res;
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
    // /_next/static: der Dateiname enthaelt den Inhalt, eine Kopie ist nie veraltet.
    const immutable = url.pathname.startsWith("/_next/static/");
    event.respondWith(
      (async () => {
        let cache = null;
        let cached = null;
        try {
          cache = await caches.open(STATIC_CACHE);
          cached = (await cache.match(request)) || null;
        } catch {
          cached = null;
        }
        const load = () =>
          fetch(request)
            .then((res) => {
              if (cache && res && res.ok) {
                try {
                  const copy = res.clone();
                  keep(event, cache.put(request, copy).then(() => trimCache(cache, STATIC_MAX_ENTRIES)));
                } catch {
                  // Kopie misslungen: die Antwort selbst geht trotzdem raus.
                }
              }
              return res;
            })
            .catch(() => null);
        if (cached) {
          if (!immutable) keep(event, load());
          return cached;
        }
        const res = await load();
        return res || new Response("", { status: 504 });
      })(),
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
