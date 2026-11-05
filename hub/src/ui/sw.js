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
<meta name="theme-color" content="#f6f8fa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#050a15" media="(prefers-color-scheme: dark)"><title>Hub nicht erreichbar</title>
<style>:root{color-scheme:light dark;--bg:oklch(0.978 0.004 255);--text:oklch(0.2 0.03 262);--muted:oklch(0.5 0.03 258);
--glass:oklch(1 0 0/58%);--border:oklch(1 0 0/85%);--hl:oklch(1 0 0/95%);--shadow:0 20px 50px -28px oklch(0.25 0.04 262/45%);
--accent:oklch(0.53 0.24 276);--a1:oklch(0.6 0.2 276/22%);--a2:oklch(0.72 0.14 232/18%);--a3:oklch(0.75 0.14 300/16%)}
@media (prefers-color-scheme:dark){:root{--bg:oklch(0.145 0.025 262);--text:oklch(0.955 0.008 255);--muted:oklch(0.72 0.025 258);
--glass:oklch(1 0 0/5.5%);--border:oklch(1 0 0/16%);--hl:oklch(1 0 0/22%);--shadow:0 24px 60px -30px oklch(0 0 0/75%);
--accent:oklch(0.56 0.22 277);--a1:oklch(0.55 0.22 276/42%);--a2:oklch(0.7 0.142 232/26%);--a3:oklch(0.8 0.118 300/22%)}}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:env(safe-area-inset-top) 1.5rem env(safe-area-inset-bottom);
font:15px/1.5 -apple-system,system-ui,sans-serif;color:var(--text);text-align:center;
background:radial-gradient(55% 45% at 12% 8%,var(--a1),transparent 65%),radial-gradient(45% 40% at 88% 18%,var(--a2),transparent 65%),
radial-gradient(50% 45% at 72% 92%,var(--a3),transparent 65%),var(--bg)}
body>div{padding:24px;border:1px solid var(--border);border-radius:24px;background:var(--glass);
box-shadow:inset 0 1px 0 var(--hl),var(--shadow);-webkit-backdrop-filter:blur(28px) saturate(170%);backdrop-filter:blur(28px) saturate(170%)}
p{color:var(--muted);margin:.4rem 0 1.2rem}button{font:inherit;font-weight:600;border:0;border-radius:14px;min-height:44px;padding:12px 20px;
background:var(--accent);color:#fff;box-shadow:inset 0 1px 0 oklch(1 0 0/28%),0 8px 20px -10px var(--accent)}</style>
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
