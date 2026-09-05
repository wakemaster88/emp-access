/*
 * Service Worker von EMP Access.
 *
 *  - Offline-Fallback: Seitenaufrufe gehen immer ans Netz; ohne Verbindung
 *    erscheint /offline statt der Browser-Fehlerseite.
 *  - Statische Dateien (/_next/static, Icons, Manifest, Splash) kommen aus
 *    dem Cache und werden im Hintergrund aufgefrischt.
 *  - /api wird nie gecacht: alles dort ist personen- oder zeitbezogen.
 *  - Web-Push anzeigen, Klick oeffnet die passende Seite, abgelaufene Abos
 *    werden still erneuert.
 *
 * VERSION bei jeder Aenderung an dieser Datei hochzaehlen: alte Caches
 * werden beim Aktivieren weggeraeumt.
 */
const VERSION = "2026-09-05-1";
const STATIC_CACHE = `emp-static-${VERSION}`;
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("emp-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/splash/") ||
    url.pathname === "/manifest.json" ||
    /\.(png|ico|svg|webp|woff2?|webmanifest)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
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
    vibrate: [100, 50, 100],
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
      .then((sub) =>
        fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON() }),
        }),
      )
      .catch(() => {}),
  );
});
