/**
 * Zustand der go2rtc-Streams auswerten (ohne Abhaengigkeiten, damit testbar).
 *
 * Hintergrund (22.11.2026): In der Zentrale hingen alle Kacheln auf
 * „Verbindung wird aufgebaut …“, waehrend Schnappschuesse (direkt von der
 * Kamera) weiter ankamen. Weder das Hub-Log noch die Oberflaeche sagten, ob
 * go2rtc von der Kamera nichts bekommt, ob der Stream in einem Format kommt,
 * das der Browser nicht abspielt (H.265), oder ob nur die WebRTC-Verbindung
 * zum Fenster scheitert. Diese Auswertung liefert genau das, ohne die
 * RTSP-URLs (enthalten Passwoerter) weiterzugeben.
 *
 * go2rtc meldet je nach Version leicht unterschiedliche Felder; alles wird
 * deshalb defensiv gelesen.
 */

export interface Go2rtcRaw {
  producers?: Array<Record<string, unknown> | null> | null;
  consumers?: Array<Record<string, unknown> | null> | null;
}

export interface StreamSummary {
  name: string;
  /** Kamera-Host aus der Quell-URL (ohne Zugangsdaten). */
  host: string | null;
  /** Videoformat, z. B. "H264" oder "H265"; null = noch unbekannt (Stream ruht). */
  video: string | null;
  /** Empfangene Bytes von der Kamera (alle Producer). */
  bytes: number;
  /** Laufende Producer (RTSP-Verbindung zur Kamera steht). */
  active: boolean;
  /** Zuschauer (WebRTC, Standbild, Tracker …). */
  consumers: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Host aus einer Quell-URL, ohne Benutzer und Passwort. */
export function hostFromUrl(url: string): string | null {
  const m = url.match(/@([^:/@]+)[:/]/) ?? url.match(/^\w+:\/\/([^:/@]+)[:/]/);
  return m ? m[1] : null;
}

/** Videoformat eines Producers aus receivers[].codec oder medias. */
function producerVideo(p: Record<string, unknown>): string | null {
  const receivers = Array.isArray(p.receivers) ? (p.receivers as Array<Record<string, unknown> | null>) : [];
  for (const r of receivers) {
    const codec = (r?.codec ?? null) as Record<string, unknown> | null;
    if (!codec) continue;
    const type = String(codec.codec_type ?? codec.kind ?? "");
    const name = String(codec.codec_name ?? codec.name ?? "");
    if (name && (type === "video" || /^(h26[45]|hevc|mjpeg|vp[89]|av1)$/i.test(name))) return normCodec(name);
  }
  const medias = Array.isArray(p.medias) ? p.medias : [];
  for (const m of medias) {
    // z. B. "video, recvonly, H264" oder "video, recvonly, H265"
    const s = String(m ?? "");
    if (!/^video/i.test(s)) continue;
    const codec = s.split(",").map((x) => x.trim()).pop();
    if (codec && codec !== s) return normCodec(codec);
  }
  return null;
}

function normCodec(name: string): string {
  const n = name.toUpperCase();
  if (n === "HEVC") return "H265";
  return n;
}

function producerBytes(p: Record<string, unknown>): number {
  const direct = num(p.bytes_recv) || num(p.recv) || num(p.bytes);
  if (direct) return direct;
  const receivers = Array.isArray(p.receivers) ? (p.receivers as Array<Record<string, unknown> | null>) : [];
  return receivers.reduce((sum, r) => sum + num(r?.bytes), 0);
}

/** Ein Producer laeuft, wenn go2rtc mehr als die reine Quell-URL meldet. */
function producerActive(p: Record<string, unknown>): boolean {
  return (
    producerBytes(p) > 0 ||
    (Array.isArray(p.receivers) && p.receivers.length > 0) ||
    typeof p.remote_addr === "string" ||
    typeof p.format_name === "string"
  );
}

export function summarizeStreams(data: Record<string, Go2rtcRaw | null> | null | undefined): StreamSummary[] {
  return Object.entries(data ?? {}).map(([name, info]) => {
    const producers = (info?.producers ?? []).filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
    const url = String(producers[0]?.url ?? "");
    let video: string | null = null;
    for (const p of producers) {
      video = producerVideo(p);
      if (video) break;
    }
    return {
      name,
      host: hostFromUrl(url),
      video,
      bytes: producers.reduce((sum, p) => sum + producerBytes(p), 0),
      active: producers.some(producerActive),
      consumers: (info?.consumers ?? []).filter(Boolean).length,
    };
  });
}

/** Formate, die Browser per WebRTC sicher abspielen. H.265 kann nur Safari (und auch nicht immer). */
export function browserPlayable(video: string | null): boolean | null {
  if (!video) return null;
  return /^(H264|VP8|VP9|AV1)$/i.test(video);
}

/**
 * Probleme, die man im Log sehen will: Streams mit Zuschauern, die nichts
 * von der Kamera bekommen, und Streams in einem Format, das Browser nicht
 * zuverlaessig abspielen. `prevBytes` sind die Bytes beim letzten Blick
 * (gleicher Stream, gleiche Zahl = es kommt nichts mehr). Ein kleinerer
 * Wert als beim letzten Blick heisst: go2rtc hat die Verbindung zur Kamera
 * neu aufgebaut und zaehlt von vorn, es fliessen also Daten.
 *
 * `stalled` ist der Befund dieses einen Blicks; als „ohne Daten“ gilt ein
 * Stream erst nach zwei Blicken in Folge (confirmStalls).
 */
export function liveProblems(
  streams: StreamSummary[],
  prevBytes: Map<string, number> = new Map()
): { stalled: string[]; unplayable: string[] } {
  const stalled: string[] = [];
  const unplayable: string[] = [];
  for (const s of streams) {
    if (s.consumers > 0) {
      const before = prevBytes.get(s.name);
      if (!s.active || s.bytes === 0 || (before != null && s.bytes === before)) stalled.push(s.name);
    }
    if (/_sub$/.test(s.name) && browserPlayable(s.video) === false) unplayable.push(`${s.name} (${s.video})`);
  }
  return { stalled, unplayable };
}

/** So viele Blicke in Folge ohne Daten, bevor der Waechter „ohne Daten“ meldet. */
export const STALL_CHECKS = 2;

/**
 * Stillstand bestaetigen: `misses` zaehlt je Stream die Blicke in Folge
 * ohne Daten (vom Aufrufer gehalten). Ein Stream, der diesmal Daten liefert,
 * faellt aus der Liste.
 */
export function confirmStalls(
  suspects: string[],
  misses: Map<string, number>,
  need = STALL_CHECKS
): { stalled: string[]; misses: Map<string, number> } {
  const next = new Map<string, number>();
  for (const name of suspects) next.set(name, (misses.get(name) ?? 0) + 1);
  return { stalled: suspects.filter((n) => (next.get(n) ?? 0) >= need), misses: next };
}

/** Kamera fuer den Abgleich mit den go2rtc-Streams. */
export interface CoverageCamera {
  name: string;
  host: string | null;
  reachable: boolean;
  /** "DOORBIRD": der Stream `doorbird` zaehlt auch ohne passenden Host. */
  kind?: string;
}

export interface StreamCoverage {
  /** Kameras, zu deren Host kein Stream gehoert. */
  missing: Array<{ camera: string; host: string }>;
  /** Streams mit einem Host, der zu keiner Kamera gehoert. */
  orphans: Array<{ host: string; streams: string[] }>;
  /** Streams einer Kamera, die gerade offline ist. */
  offline: Array<{ camera: string; streams: string[] }>;
  /** Kameras, die gerade offline sind (auch ohne Stream). */
  camerasOffline: number;
}

const hostKey = (h: string | null | undefined) => (h ?? "").trim().toLowerCase();
const isLocalHost = (h: string) => h === "localhost" || /^127\./.test(h);

/**
 * Passen Kameras und go2rtc-Streams zusammen? Zuordnung wie in der Zentrale
 * ueber den Host aus der Quell-URL (ohne RTSP-Abfrage). Streams ohne Host
 * oder mit lokaler Quelle (Maeher, ffmpeg) bleiben aussen vor.
 */
export function streamCoverage(streams: StreamSummary[], cameras: CoverageCamera[]): StreamCoverage {
  const byHost = new Map<string, string[]>();
  for (const s of streams) {
    const h = hostKey(s.host);
    if (!h || isLocalHost(h)) continue;
    byHost.set(h, [...(byHost.get(h) ?? []), s.name]);
  }
  // Wie streamFor in der Zentrale: Findet eine DoorBird keinen Stream mit
  // ihrem Host, nimmt sie den Stream `doorbird`.
  const doorbird = streams.find((s) => s.name === "doorbird");
  const usedHosts = new Set<string>();
  const missing: StreamCoverage["missing"] = [];
  const offline: StreamCoverage["offline"] = [];
  let camerasOffline = 0;
  for (const c of cameras) {
    if (!c.reachable) camerasOffline++;
    const h = hostKey(c.host);
    if (!h) continue;
    let mine = byHost.get(h) ?? [];
    if (mine.length) usedHosts.add(h);
    else if (c.kind === "DOORBIRD" && doorbird) {
      mine = ["doorbird"];
      usedHosts.add(hostKey(doorbird.host));
    }
    if (!mine.length) {
      missing.push({ camera: c.name, host: c.host!.trim() });
      continue;
    }
    if (!c.reachable) offline.push({ camera: c.name, streams: [...mine].sort() });
  }
  const orphans: StreamCoverage["orphans"] = [];
  for (const [h, names] of byHost) {
    if (!usedHosts.has(h)) orphans.push({ host: h, streams: [...names].sort() });
  }
  const byName = (a: { camera: string }, b: { camera: string }) => a.camera.localeCompare(b.camera, "de");
  return {
    missing: missing.sort(byName),
    orphans: orphans.sort((a, b) => a.host.localeCompare(b.host)),
    offline: offline.sort(byName),
    camerasOffline,
  };
}

/** Zeile fuers Hub-Log (nur bei Aenderung geschrieben); null = alles passt. */
export function coverageLine(c: StreamCoverage): string | null {
  const parts: string[] = [];
  if (c.missing.length) parts.push(`kein Stream für Kamera ${c.missing.map((m) => `${m.camera} (Host ${m.host})`).join(", ")}`);
  for (const o of c.orphans) parts.push(`Stream ohne Kamera: ${o.streams.join(", ")} (Host ${o.host})`);
  if (c.offline.length) parts.push(`Kamera offline: ${c.offline.map((o) => `${o.camera} (${o.streams.join(", ")})`).join(", ")}`);
  return parts.length ? `go2rtc: ${parts.join(" · ")}` : null;
}

/**
 * Gutmeldung, wenn die Probleme vorbei sind: sagt, was wirklich geprueft
 * wurde (nur Streams mit Zuschauern), statt „alle Streams in Ordnung“.
 */
export function watchOkLine(streams: StreamSummary[], camerasOffline: number): string {
  const watched = streams.filter((s) => s.consumers > 0).length;
  const idle = streams.length - watched;
  const head =
    watched === 0
      ? "kein Stream wird gerade angesehen"
      : watched === 1
        ? "der angesehene Stream liefert Daten"
        : `alle ${watched} angesehenen Streams liefern Daten`;
  const rest = [`${idle} ${idle === 1 ? "ruht" : "ruhen"}`];
  if (camerasOffline > 0) rest.push(`${camerasOffline} ${camerasOffline === 1 ? "Kamera" : "Kameras"} offline`);
  return `go2rtc: ${head} (${rest.join(", ")})`;
}

/**
 * Zugangsdaten vor dem Loggen maskieren: in Quell-URLs alles zwischen `//`
 * und dem letzten `@` vor dem Host (auch mit `/` oder `@` im Passwort) wird
 * `//***@`, Werte von `user=`, `password=`, `token=` und aehnlichen
 * Parametern werden `***`.
 */
export function maskUrlAuth(text: string): string {
  return text
    .replace(/\/\/[^\s"'<>]*@/g, "//***@")
    .replace(/(?<![A-Za-z0-9])(user|username|password|pass|pwd|token|key)=[^&\s"']*/gi, "$1=***");
}

/** Gescheiterte WebRTC-Anfragen je Stream, fuer die Drossel im Log. */
export interface WebrtcFailState {
  firstAt: number;
  lastAt: number;
  count: number;
  loggedAt: number;
  /** Erster Erfolg nach dem letzten Fehlschlag (Beginn der Zeit mit Bild), sonst fehlt das Feld. */
  okAt?: number;
}

/** Nach der ersten Zeile hoechstens so oft „weiter ohne Bild“ je Stream. */
export const WEBRTC_REPEAT_MS = 60 * 60_000;

/**
 * Drossel je Stream statt je Fehlertext (go2rtc nennt fuer dieselbe tote
 * Kamera abwechselnd „i/o timeout“, „host is down“, „no route to host“):
 * erste Zeile sofort, danach hoechstens stuendlich eine Sammelzeile. Kam
 * laenger als die Frist kein Versuch, beginnt die Zaehlung neu, ebenso,
 * wenn der Stream davor mindestens `quietMs` lang Bild hatte (neue Stoerung).
 */
export function webrtcFailureStep(
  prev: WebrtcFailState | undefined,
  now: number,
  everyMs = WEBRTC_REPEAT_MS,
  quietMs = WEBRTC_OK_QUIET_MS
): { next: WebrtcFailState; log: "first" | "repeat" | null } {
  const upLongEnough = !!prev && prev.okAt != null && prev.okAt > prev.lastAt && now - prev.okAt >= quietMs;
  if (!prev || now - prev.lastAt > everyMs || upLongEnough) {
    return { next: { firstAt: now, lastAt: now, count: 1, loggedAt: now }, log: "first" };
  }
  const { okAt: _ok, ...rest } = prev;
  const next = { ...rest, lastAt: now, count: prev.count + 1 };
  if (now - prev.loggedAt < everyMs) return { next, log: null };
  return { next: { ...next, loggedAt: now }, log: "repeat" };
}

/** So lange ohne Fehlschlag, bis ein Erfolg die Drossel eines Streams loest. */
export const WEBRTC_OK_QUIET_MS = 10 * 60_000;

/**
 * Gelungene Anfrage (oder Kachel „live“). Liegt der letzte Fehlschlag
 * mindestens `quietMs` zurueck, endet die Zaehlung (undefined). Sonst merkt
 * sich der Stream den Beginn der Zeit mit Bild (`okAt`): Eine flatternde
 * Kamera (abwechselnd Bild und Fehler) bleibt bei der stuendlichen
 * Sammelzeile, eine neue Stoerung nach mindestens `quietMs` mit Bild kommt
 * dagegen sofort als erste Zeile (webrtcFailureStep).
 */
export function webrtcOkStep(
  prev: WebrtcFailState | undefined,
  now: number,
  quietMs = WEBRTC_OK_QUIET_MS
): WebrtcFailState | undefined {
  if (!prev || now - prev.lastAt >= quietMs) return undefined;
  if (prev.okAt != null && prev.okAt > prev.lastAt) return prev;
  return { ...prev, okAt: now };
}

function berlinClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
}

/** Log-Zeile zu webrtcFailureStep; `msg` ist schon maskiert. */
export function webrtcFailureLine(src: string, msg: string, kind: "first" | "repeat", st: WebrtcFailState): string {
  if (kind === "first") return `go2rtc WebRTC ${src}: ${msg}`;
  return `go2rtc WebRTC ${src}: weiter ohne Bild (${st.count} Versuche seit ${berlinClock(st.firstAt)}), zuletzt ${msg}`;
}

/** Anhang fuer eine gedrosselte Kachel-Meldung, z. B. „31 Meldungen seit 12:58“. */
export function repeatNote(st: WebrtcFailState): string {
  return `${st.count} Meldungen seit ${berlinClock(st.firstAt)}`;
}

/** Eine Zeile fuers Hub-Log; null, wenn alles gut ist. */
export function liveProblemLine(p: { stalled: string[]; unplayable: string[] }, total: number): string | null {
  const parts: string[] = [];
  if (p.stalled.length) parts.push(`${p.stalled.length}/${total} ohne Daten von der Kamera: ${p.stalled.join(", ")}`);
  if (p.unplayable.length) parts.push(`Format nicht abspielbar: ${p.unplayable.join(", ")}`);
  return parts.length ? `go2rtc: ${parts.join(" · ")}` : null;
}

export interface ClientReport {
  src: string;
  event: string;
  line: string;
}

/** Browser-Name grob aus dem User-Agent (fuers Log, ohne Versionen). */
export function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

/**
 * Zustandsmeldung einer Kachel pruefen und als Log-Zeile formulieren; null,
 * wenn die Meldung unbrauchbar ist. Nur feste, kurze Felder – die Route ist
 * ohne Anmeldung vom Hub-Rechner erreichbar.
 */
export function clientReport(body: Record<string, unknown>, ua: string): ClientReport | null {
  const src = String(body.src ?? "");
  const event = String(body.event ?? "").slice(0, 60);
  if (!/^[^\s/?#&]{1,80}$/.test(src) || !/^[\w :.-]{1,60}$/.test(event)) return null;
  const word = (v: unknown) => (typeof v === "string" && /^[a-z]{1,16}$/.test(v) ? v : "-");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const parts = [
    `Verbindung ${word(body.conn)}`,
    `ICE ${word(body.ice)}`,
    `Bilder ${n(body.frames)}`,
    `Größe ${n(body.w)}×${n(body.h)}`,
    `Versuch ${n(body.attempts)}`,
  ];
  // Dauer vom Angebot bis „connected“ (bzw. bis zum Abbruch), hoechstens 10 min.
  if (typeof body.ms === "number" && Number.isFinite(body.ms) && body.ms > 0 && body.ms <= 600_000) {
    parts.push(`Aufbau ${(body.ms / 1000).toFixed(1).replace(".", ",")} s`);
  }
  const cand = candidateText(body);
  if (cand) parts.push(cand);
  if (body.paused === true) parts.push("pausiert");
  if (body.hidden === true) parts.push("Fenster verdeckt");
  return { src, event, line: `Zentrale (${browserName(ua)}) ${src}: ${event} – ${parts.join(", ")}` };
}

const CAND_TYPES = new Set(["host", "srflx", "prflx", "relay"]);
const PAIR_STATES = new Set(["succeeded", "in-progress", "failed", "waiting", "frozen"]);

/** Kandidat der Gegenseite (go2rtc) aus der Meldung: nur Typ, IP-Adresse und Port nach festem Muster. */
function candidateText(body: Record<string, unknown>): string | null {
  const type = typeof body.candType === "string" && CAND_TYPES.has(body.candType) ? body.candType : null;
  if (!type) return null;
  const addr = typeof body.candAddr === "string" ? body.candAddr : "";
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  const ip = v4 && v4.slice(1).every((x) => Number(x) <= 255) ? addr : /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i.test(addr) ? `[${addr.toLowerCase()}]` : null;
  const port = typeof body.candPort === "number" && Number.isInteger(body.candPort) && body.candPort > 0 && body.candPort < 65536 ? body.candPort : null;
  const state = typeof body.candState === "string" && PAIR_STATES.has(body.candState) ? ` ${body.candState}` : "";
  return `Kandidat ${type}${ip ? ` ${ip}${port ? `:${port}` : ""}` : ""}${state}`;
}
