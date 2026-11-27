/*
 * Regeln der Livebild-Kacheln (ohne DOM, ohne Netz): Zeitlimits und
 * Neuversuche der WebRTC-Verbindung, Staffelung beim Verbindungsaufbau,
 * Kandidat aus getStats, Stream fuer die Personen-Boxen, Neu laden nach
 * einem Hub-Update, Einstellung „Livebild und Vorschau“ je Kamera.
 *
 * Klassisches Skript wie dashboard.js (vor ihm geladen): legt nur das
 * Objekt `RtcRules` an. Die Tests laden die Datei mit node:vm
 * (hub/src/rtc-rules.test.ts).
 */
const RtcRules = (() => {
  /** Zeitlimit nach der Antwort von go2rtc, bis die Verbindung „connected“ sein muss. */
  const FIRST_TIMEOUT_MS = 6000;
  const LATER_TIMEOUT_MS = 15000;
  /** Wartezeit vor dem naechsten Versuch, wenn die Kamera als offline gemeldet ist. */
  const OFFLINE_RETRY_MS = 120000;
  /** Hoechstens so viele Kacheln gleichzeitig im Verbindungsaufbau ... */
  const GATE_MAX = 3;
  /** ... und jede belegt ihren Platz hoechstens so lange (danach darf die naechste). */
  const GATE_HOLD_MS = 2000;

  /*
   * Erster Versuch mit kurzem Zeitlimit: In Safari blieb beim Oeffnen der
   * Zentrale die Mehrzahl der Kacheln in „ICE checking“ haengen und stand
   * erst nach dem Zeitlimit von 15 s plus Neuaufbau; der zweite Versuch
   * stand dann in 3 bis 5 s. Weitere Versuche behalten 15 s. Maeher-Kameras
   * (ueber die Mammotion-Cloud) brauchen laenger und behalten immer 15 s.
   * `attempts` = Fehlversuche in Folge (0 = erster Versuch).
   */
  function rtcTimeoutMs(attempts, kind) {
    if (kind === "MOWER") return LATER_TIMEOUT_MS;
    return attempts > 0 ? LATER_TIMEOUT_MS : FIRST_TIMEOUT_MS;
  }

  /*
   * Wartezeit bis zum naechsten Versuch nach `attempts` Fehlversuchen in
   * Folge: online 2, 4, 8, dann 15 s. Ist die Kamera als offline gemeldet,
   * nach dem ersten Fehlschlag 120 s (go2rtc waehlt sonst alle 15 s die
   * tote Adresse an). Nach einem ICE-Zeitlimit sofort neu, solange die
   * Kamera erreichbar ist. `reachable` null/undefined = unbekannt, gilt als
   * online.
   */
  function tileRetryDelay(attempts, reachable, why) {
    if (!(attempts > 0)) return 0;
    if (reachable === false) return OFFLINE_RETRY_MS;
    if (why === "ice-timeout") return 0;
    return Math.min(LATER_TIMEOUT_MS, 2000 * 2 ** Math.min(3, attempts - 1));
  }

  /* Kamera wieder erreichbar: wartende Kachel sofort neu verbinden statt nach 120 s. */
  function reconnectNow(wasReachable, reachable) {
    return wasReachable === false && reachable === true;
  }

  /*
   * Staffelung: Wie viele wartende Kacheln duerfen jetzt ihren Aufbau
   * beginnen, und wann lohnt der naechste Blick? `busyStarts` = Startzeiten
   * der Kacheln, die noch im Aufbau sind (nicht „connected“). Eine Kachel
   * gibt ihren Platz frei, sobald sie verbunden ist, spaetestens nach 2 s.
   * waitMs null = nichts zu tun.
   */
  function gatePlan(busyStarts, queued, now, opts) {
    const max = (opts && opts.max) || GATE_MAX;
    const holdMs = (opts && opts.holdMs) || GATE_HOLD_MS;
    const busy = busyStarts.filter((t) => now - t < holdMs);
    const start = Math.max(0, Math.min(queued, max - busy.length));
    if (queued - start <= 0) return { start, waitMs: null };
    // Naechster freier Platz: wenn die aelteste belegte Kachel ihre Frist erreicht.
    const ends = busy.map((t) => t + holdMs - now);
    for (let i = 0; i < start; i++) ends.push(holdMs);
    return { start, waitMs: Math.max(50, Math.min(...ends)) };
  }

  /*
   * Kandidat der Gegenseite (go2rtc) aus pc.getStats() als Liste:
   * der gewaehlte, sonst der zuletzt gepruefte. null = keiner bekannt.
   */
  function pickCandidate(stats) {
    const list = Array.isArray(stats) ? stats.filter((r) => r && typeof r === "object") : [];
    const byId = new Map(list.map((r) => [r.id, r]));
    const pairs = list.filter((r) => r.type === "candidate-pair");
    let pair = null;
    for (const t of list) {
      if (t.type === "transport" && t.selectedCandidatePairId && byId.has(t.selectedCandidatePairId)) {
        pair = byId.get(t.selectedCandidatePairId);
        break;
      }
    }
    const last = (rs) =>
      rs.slice().sort((a, b) => (Number(b.lastPacketSentTimestamp) || 0) - (Number(a.lastPacketSentTimestamp) || 0) || (Number(b.requestsSent) || 0) - (Number(a.requestsSent) || 0))[0] || null;
    if (!pair) pair = pairs.find((p) => p.selected) || last(pairs.filter((p) => p.nominated && p.state === "succeeded"));
    if (!pair) pair = last(pairs.filter((p) => p.state === "in-progress")) || last(pairs.filter((p) => p.state === "failed")) || last(pairs);
    if (!pair) return null;
    const remote = byId.get(pair.remoteCandidateId);
    if (!remote) return null;
    return {
      type: typeof remote.candidateType === "string" ? remote.candidateType : null,
      address: typeof remote.address === "string" ? remote.address : typeof remote.ip === "string" ? remote.ip : null,
      port: typeof remote.port === "number" ? remote.port : null,
      state: typeof pair.state === "string" ? pair.state : null,
    };
  }

  /*
   * Stream fuer die Personen-Boxen der Grossansicht: der Sub-Stream (640 px,
   * so rechnet der Tracker ohnehin), der Hauptstream nur, wenn es keinen
   * Sub-Stream gibt. Zuordnung wie streamFor ueber den Host; die DoorBird
   * nimmt ohne passenden Host den Stream `doorbird`.
   */
  function boxStream(cam, streams) {
    const list = Array.isArray(streams) ? streams : [];
    const names = list.filter((s) => s && s.host && s.host === cam.host).map((s) => s.name);
    if (!names.length) return cam.kind === "DOORBIRD" && list.some((s) => s && s.name === "doorbird") ? "doorbird" : null;
    return names.find((n) => /_sub$/.test(n)) || names.find((n) => !/_(main|sub)$/.test(n)) || names.find((n) => /_main$/.test(n)) || null;
  }

  /*
   * Einstellung „Livebild und Vorschau“ je Kamera (liveMode aus
   * /api/overview, live-mode-rules.ts im Hub): "auto" startet das Livebild
   * von selbst, "click" erst nach einem Tippen, "off" zeigt die Kamera in
   * der Zentrale gar nicht. Fehlt der Wert (Maeher, aelterer Hub), gilt
   * "auto" wie bisher; ein unbekannter Wert gilt wie "click".
   */
  const CLICK_LIVE_MAX_MS = 5 * 60 * 1000;

  function liveModeOf(cam) {
    const raw = cam ? cam.liveMode : null;
    if (raw === null || raw === undefined) return "auto";
    const v = String(raw).trim().toLowerCase();
    if (v === "" || v === "auto") return "auto";
    if (v === "off") return "off";
    return "click";
  }

  /* Kachel und Grossansicht: nicht bei „aus“. */
  function tileShown(cam) {
    return liveModeOf(cam) !== "off";
  }

  /* Kameras der Zentrale (Kacheln, Grossansicht, Durchblaettern): ohne die mit „aus“. */
  function zentraleCams(cams) {
    return (Array.isArray(cams) ? cams : []).filter(tileShown);
  }

  /*
   * Ist ein Tippen (Zeitpunkt in ms) abgelaufen? Nach 5 Minuten endet ein
   * getipptes Livebild von selbst; ohne Tippen gibt es nichts, das laeuft.
   */
  function tapExpired(tappedAt, now) {
    return !(typeof tappedAt === "number" && now >= tappedAt && now - tappedAt < CLICK_LIVE_MAX_MS);
  }

  /*
   * Darf das Livebild dieser Kamera jetzt laufen (WebRTC, Personen-Boxen)?
   * „automatisch“: ja. „nur auf Tippen“: nur nach einem Tippen, hoechstens
   * 5 Minuten lang und nur bei sichtbarer Seite. „aus“: nie.
   */
  function liveAllowed(cam, tappedAt, now, hidden) {
    const mode = liveModeOf(cam);
    if (mode === "off") return false;
    if (mode === "auto") return true;
    return !hidden && !tapExpired(tappedAt, now);
  }

  /*
   * Abgelaufene Tippen aus einer Liste [id, Zeitpunkt]: diese Livebilder
   * enden jetzt. nextMs = Wartezeit bis zum naechsten Ablauf, null = keins mehr offen.
   */
  function tapExpiry(taps, now) {
    const expired = [];
    let nextMs = null;
    for (const [id, at] of Array.isArray(taps) ? taps : []) {
      if (tapExpired(at, now)) expired.push(id);
      else {
        const left = at + CLICK_LIVE_MAX_MS - now;
        nextMs = nextMs === null ? left : Math.min(nextMs, left);
      }
    }
    return { expired, nextMs };
  }

  /*
   * Kameras, deren Einstellung „Livebild und Vorschau“ sich seit dem letzten
   * Zeichnen geaendert hat, in beide Richtungen. `prev`: Map id → Modus
   * (liveModeOf). Eine Kamera, die neu dazukommt, zaehlt nicht. Bei einer
   * Aenderung verfallen ihre Tippen; Kachel und Grossansicht zeichnet die
   * Zentrale neu.
   */
  function modeChanges(prev, cams) {
    const changed = [];
    for (const c of cams) {
      const was = prev.get(c.id);
      if (was !== undefined && was !== liveModeOf(c)) changed.push(c.id);
    }
    return changed;
  }

  /* Bereiche mit Eingabefeldern auf der Seite: dort nie von selbst neu laden. */
  const FORM_VIEWS = new Set(["aktionen"]);

  /*
   * Neuer Oberflaechen-Stand auf dem Hub (`ui` aus /api/status)? Neu laden
   * nur, wenn der Tab verdeckt ist oder gerade wieder sichtbar wird
   * (`hidden`), und nichts Grosses offen ist (Grossansicht, Dialog,
   * Vollbild, Eingabe). Sonst nur ein kleiner Hinweis.
   * Ergebnis: "none" | "reload" | "hint".
   */
  function shouldReload({ loadedUi, currentUi, view, dialogOpen, hidden }) {
    if (!loadedUi || !currentUi || loadedUi === currentUi) return "none";
    if (dialogOpen || FORM_VIEWS.has(view)) return "hint";
    return hidden ? "reload" : "hint";
  }

  return {
    FIRST_TIMEOUT_MS,
    LATER_TIMEOUT_MS,
    OFFLINE_RETRY_MS,
    GATE_MAX,
    GATE_HOLD_MS,
    rtcTimeoutMs,
    tileRetryDelay,
    reconnectNow,
    gatePlan,
    pickCandidate,
    boxStream,
    shouldReload,
    CLICK_LIVE_MAX_MS,
    liveModeOf,
    tileShown,
    zentraleCams,
    tapExpired,
    liveAllowed,
    tapExpiry,
    modeChanges,
  };
})();
