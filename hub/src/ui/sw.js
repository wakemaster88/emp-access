/*
 * Service Worker des Hub-Dashboards.
 *
 * Nur die App-Huelle (HTML, CSS, JS, Icons) wird zwischengespeichert, und
 * zwar "Netz zuerst": Solange der Hub antwortet, kommt immer der frische
 * Stand (der Hub zieht main alle paar Minuten nach). Der Cache springt nur
 * ein, wenn der Hub nicht erreichbar ist – dann startet die App trotzdem
 * und zeigt "Hub nicht erreichbar" statt einer leeren Safari-Fehlerseite.
 *
 * Nie angefasst werden /api/* (Lage, Ereignisse, go2rtc-Signalisierung,
 * Standbilder) und alles mit Query-String (z. B. ?token=…): Das geht immer
 * direkt ans Netz, damit nichts Veraltetes oder Geheimes im Cache landet.
 */
const CACHE = "hub-shell-v1";
const SHELL = [
  "/",
  "/dashboard.css",
  "/dashboard.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
];
const NET_TIMEOUT_MS = 4000;

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches
      .open(CACHE)
      // Einzeln, damit ein fehlendes Icon nicht die ganze Installation kippt.
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "no-cache" })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hub-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShell(url) {
  return url.pathname === "/" || url.pathname === "/index.html" || SHELL.includes(url.pathname) || url.pathname.startsWith("/icons/");
}

/**
 * Netz mit Zeitlimit; nur saubere 200er (keine Login-Seite, keine
 * Umleitung) landen im Cache. Die Anfrage wird unveraendert weitergereicht
 * (Navigationen duerfen keine neuen Optionen bekommen), das Zeitlimit
 * laeuft daher als Wettrennen.
 */
async function networkFirst(req, cacheKey) {
  const cache = await caches.open(CACHE);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), NET_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([fetch(req), timeout]);
    clearTimeout(timer);
    if (res.status === 200 && !res.redirected && res.type === "basic") {
      cache.put(cacheKey, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    clearTimeout(timer);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    throw e;
  }
}

const OFFLINE_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#060912"><title>Hub nicht erreichbar</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:env(safe-area-inset-top) 1.5rem env(safe-area-inset-bottom);
font:15px/1.5 -apple-system,system-ui,sans-serif;background:#060912;color:#e9edf7;text-align:center}
p{color:#94a0ba;margin:.4rem 0 1.2rem}button{font:inherit;font-weight:600;border:0;border-radius:12px;padding:12px 20px;background:#22d3ee;color:#04121a}</style>
</head><body><div><h1 style="font-size:1.2rem;margin:0">Hub nicht erreichbar</h1>
<p>Bist du im Netz des Standorts (WLAN oder VPN)?</p><button onclick="location.reload()">Erneut versuchen</button></div></body></html>`;

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // ?token=… loest auf dem Server eine Umleitung mit Cookie aus – das soll
  // der Browser selbst erledigen, Safari mag umgeleitete SW-Antworten nicht.
  if (url.search) return;

  if (req.mode === "navigate") {
    ev.respondWith(
      networkFirst(req, "/").catch(
        () => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })
      )
    );
    return;
  }
  if (isShell(url)) {
    ev.respondWith(networkFirst(req, url.pathname));
  }
});
