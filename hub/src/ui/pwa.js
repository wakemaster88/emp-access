/*
 * Home-Bildschirm-App (PWA) fuer iPhone und iPad.
 *
 * - Registriert den Service Worker (/sw.js). Den gibt es nur in einem
 *   sicheren Kontext, also per HTTPS mit installierter Hub-CA (siehe
 *   src/dashboard-tls.ts) oder auf dem Hub selbst ueber localhost.
 * - Zeigt auf Telefon/Tablet einen kleinen Hinweis, was fuer die
 *   App-Installation noch fehlt: erst HTTPS einrichten, dann
 *   "Teilen → Zum Home-Bildschirm". Ausblendbar, merkt sich das pro Schritt.
 */
(function () {
  "use strict";

  const root = document.documentElement;
  const standalone = root.classList.contains("is-standalone");
  const ua = navigator.userAgent;
  // iPadOS meldet sich als Mac – an den Touchpunkten erkennbar.
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isTouch = isIos || /Android/.test(ua) || matchMedia("(pointer: coarse)").matches;
  if (isTouch) root.classList.add("is-touch");

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    });
  }

  const box = document.getElementById("pwaHint");
  const text = document.getElementById("pwaHintText");
  const closeBtn = document.getElementById("pwaHintClose");
  if (!box || !text || !closeBtn || !isTouch) return;

  function dismissed(key) {
    try {
      return localStorage.getItem(`hub-pwa-hint-${key}`) === "1";
    } catch {
      return false;
    }
  }
  function dismiss(key) {
    try {
      localStorage.setItem(`hub-pwa-hint-${key}`, "1");
    } catch {
      // privater Modus
    }
  }

  function show(key, html) {
    if (dismissed(key)) return;
    text.innerHTML = html;
    box.hidden = false;
    closeBtn.onclick = () => {
      box.hidden = true;
      dismiss(key);
    };
  }

  const httpsUrl = `https://${location.host}${location.pathname}${location.hash}`;

  /** Ist die Hub-CA auf diesem Geraet schon vertraut? Dann klappt HTTPS ohne Fehler. */
  async function httpsTrusted() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      await fetch(`https://${location.host}/manifest.webmanifest`, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
      clearTimeout(t);
      return true;
    } catch {
      return false;
    }
  }

  async function decide() {
    if (location.protocol === "http:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      let info = null;
      try {
        const r = await fetch("/api/pwa", { headers: { Accept: "application/json" }, cache: "no-store" });
        if (r.ok) info = await r.json();
      } catch {
        // Hub gerade nicht erreichbar – dann kein Hinweis.
      }
      if (!info || !info.https) return;
      if (await httpsTrusted()) {
        show(
          "switch",
          `<strong>HTTPS ist eingerichtet.</strong> <a href="${httpsUrl}">Zur sicheren Adresse wechseln</a>${
            standalone ? " – und die App von dort neu zum Home-Bildschirm hinzufügen." : ", dann von dort zum Home-Bildschirm hinzufügen."
          }`
        );
        return;
      }
      show(
        "cert",
        `<strong>Als App installieren:</strong> Einmal das <a href="/ca.crt">Hub-Zertifikat laden</a>${
          isIos
            ? ", dann <em>Einstellungen → Allgemein → VPN &amp; Geräteverwaltung</em> → Profil installieren und unter <em>Allgemein → Info → Zertifikatsvertrauenseinstellungen</em> einschalten."
            : " und als vertrauenswürdig installieren."
        } Danach <a href="${httpsUrl}">die HTTPS-Adresse öffnen</a>.`
      );
      return;
    }
    if (!standalone && isIos) {
      show(
        "install",
        `<strong>Als App installieren:</strong> In Safari auf <em>Teilen</em> tippen und <em>Zum Home-Bildschirm</em> wählen – dann startet der Hub im Vollbild ohne Adressleiste.`
      );
    }
  }

  decide();
})();
