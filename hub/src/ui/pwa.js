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

  /*
   * Telefon: Die Tab-Leiste zeigt Zentrale, Lage, Kameras, Ereignisse und
   * "Mehr"; der Rest kommt in ein kleines Blatt darueber. Die Zaehler der
   * versteckten Bereiche erscheinen gesammelt am "Mehr"-Knopf.
   */
  const nav = document.getElementById("nav");
  const moreBtn = document.getElementById("navMore");
  const sheet = document.getElementById("moreSheet");
  const moreCount = document.getElementById("navMoreCount");
  if (nav && moreBtn && sheet && moreCount) {
    const extras = () => [...nav.querySelectorAll("a.nav-extra")];
    const closeSheet = () => {
      sheet.hidden = true;
      moreBtn.setAttribute("aria-expanded", "false");
    };
    const openSheet = () => {
      sheet.innerHTML = "";
      for (const a of extras()) {
        const c = a.cloneNode(true);
        c.classList.remove("nav-extra");
        c.querySelector(".nav-count")?.removeAttribute("data-count");
        sheet.appendChild(c);
      }
      sheet.hidden = false;
      moreBtn.setAttribute("aria-expanded", "true");
    };
    moreBtn.addEventListener("click", () => (sheet.hidden ? openSheet() : closeSheet()));
    sheet.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) closeSheet();
    });
    document.addEventListener("click", (ev) => {
      if (!sheet.hidden && !sheet.contains(ev.target) && !moreBtn.contains(ev.target)) closeSheet();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !sheet.hidden) closeSheet();
    });
    window.addEventListener("hashchange", closeSheet);

    const syncMore = () => {
      let n = 0;
      let tone = "";
      for (const a of extras()) {
        const el = a.querySelector(".nav-count");
        // Nur Hinweise (Warnung/Alarm) zaehlen, keine reinen Mengen wie "77 Geraete".
        const isAlert = el && el.classList.contains("alert");
        const isWarn = el && el.classList.contains("warn");
        if (!isAlert && !isWarn) continue;
        const v = Number(el.textContent || 0);
        n += v > 0 ? v : 1;
        if (isAlert) tone = "alert";
        else if (!tone) tone = "warn";
      }
      const text = n > 0 ? String(n > 99 ? "99+" : n) : "";
      // Nur bei Aenderung schreiben – der Beobachter sieht auch diese Knoten.
      if (moreCount.textContent !== text) moreCount.textContent = text;
      const cls = `nav-count ${tone}`.trim();
      if (moreCount.className !== cls) moreCount.className = cls;
      const active = extras().some((a) => a.hasAttribute("aria-current"));
      if (moreBtn.classList.contains("is-current") !== active) moreBtn.classList.toggle("is-current", active);
    };
    new MutationObserver(syncMore).observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-current", "class"] });
    syncMore();
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
