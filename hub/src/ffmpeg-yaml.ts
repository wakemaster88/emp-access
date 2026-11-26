/**
 * go2rtc.yaml: ffmpeg-Pfad festlegen, RTSP-Server auf Loopback legen und
 * die Lausch-Adressen lesen (ohne Abhaengigkeiten, damit testbar).
 *
 * Die Datei schreibt die Kiosk-App (webcams/lib/go2rtc.ts). Der Hub ergaenzt
 * nur fehlende Top-Level-Bloecke; vorhandene laesst er, wie sie sind.
 */

/** Lausch-Adresse des RTSP-Servers: nur dieser Rechner (der Tracker liest lokal). */
export const RTSP_LOOPBACK_LISTEN = "127.0.0.1:8554";
/** Voreinstellungen von go2rtc, wenn der Block oder `listen` fehlt. */
export const GO2RTC_API_DEFAULT = ":1984";
export const GO2RTC_RTSP_DEFAULT = ":8554";

/**
 * Was der Hub an go2rtc einrichtet (pure, damit testbar), nur auf macOS:
 * `HUB_FFMPEG_SETUP=0` laesst ffmpeg suchen und installieren aus,
 * `HUB_GO2RTC_YAML=0` jedes Lesen und Schreiben der go2rtc.yaml.
 */
export function go2rtcSetupSwitches(
  platform: string,
  env: Record<string, string | undefined>,
): { ffmpeg: boolean; yaml: boolean } {
  if (platform !== "darwin") return { ffmpeg: false, yaml: false };
  return { ffmpeg: env.HUB_FFMPEG_SETUP !== "0", yaml: env.HUB_GO2RTC_YAML !== "0" };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Kopf eines Top-Level-Schluessels: `name:`, `"name":` oder `'name':`, in
 * der ersten Zeile auch mit BOM davor. Eingerueckte Zeilen zaehlen nicht.
 */
function topKey(name: string, rest = ""): RegExp {
  const n = escapeRe(name);
  return new RegExp(`^\\uFEFF?(?:"${n}"|'${n}'|${n})\\s*:${rest}`, "m");
}

/** Steht in der yaml schon ein Top-Level-Block `<name>:`? Eingerueckte Zeilen zaehlen nicht. */
export function hasTopLevelBlock(yaml: string, name: string): boolean {
  return topKey(name).test(yaml);
}

/** Steht in der yaml schon ein Top-Level-Block `ffmpeg:`? */
export function hasFfmpegBlock(yaml: string): boolean {
  return hasTopLevelBlock(yaml, "ffmpeg");
}

function append(yaml: string, block: string): string {
  const sep = yaml.length === 0 || yaml.endsWith("\n") ? "" : "\n";
  return `${yaml}${sep}\n${block}`;
}

/** Haengt `ffmpeg: bin: <pfad>` an, falls noch kein ffmpeg-Block existiert. */
export function withFfmpegBin(yaml: string, bin: string): string {
  if (hasFfmpegBlock(yaml)) return yaml;
  return append(yaml, `ffmpeg:\n  bin: ${bin}\n`);
}

/**
 * Haengt `rtsp: listen: "127.0.0.1:8554"` an, falls kein Top-Level-Block
 * `rtsp:` existiert. Ein vorhandener Block bleibt unveraendert; Quellen wie
 * `    - "rtsp://…"` unter `streams:` sind eingerueckt und zaehlen nicht.
 */
export function withLoopbackRtsp(yaml: string): string {
  if (hasTopLevelBlock(yaml, "rtsp")) return yaml;
  return append(yaml, `rtsp:\n  listen: "${RTSP_LOOPBACK_LISTEN}"\n`);
}

/** Lausch-Adresse der API, wenn der Hub sie setzt (Port 1984 oder der bisherige). */
export const API_LOOPBACK_HOST = "127.0.0.1";
const GO2RTC_API_PORT = 1984;

/**
 * Spricht diese URL go2rtc unter 127.0.0.1 an (127.0.0.1 oder localhost)?
 * ::1 oder 127.0.0.2 nicht: Die API lauscht danach nur auf 127.0.0.1.
 * Nicht lesbar = nein.
 */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Darf der Hub die go2rtc-API auf 127.0.0.1 legen? Nur wenn Hub und Kiosk
 * go2rtc lokal ansprechen. `kioskUrl`: settings.go2rtcUrl aus der
 * Kiosk-Konfiguration, undefined = nicht gesetzt (Voreinstellung des Kiosks
 * ist lokal), null = Konfiguration nicht lesbar (dann nichts aendern).
 */
export function apiLoopbackAllowed(hubUrl: string, kioskUrl: string | null | undefined): boolean {
  if (!isLoopbackUrl(hubUrl)) return false;
  if (kioskUrl === null) return false;
  return kioskUrl === undefined || isLoopbackUrl(kioskUrl);
}

/** go2rtcUrl aus dem Inhalt der Kiosk-Konfiguration (config.json); null = nicht lesbar. */
export function kioskGo2rtcUrl(json: string): string | null | undefined {
  try {
    const c = JSON.parse(json) as { settings?: { go2rtcUrl?: unknown } } | null;
    if (!c || typeof c !== "object") return null;
    const u = c.settings?.go2rtcUrl;
    if (u === undefined || u === "") return undefined;
    return typeof u === "string" ? u : null;
  } catch {
    return null;
  }
}

/** Einrueckung einer Zeile (Anzahl fuehrender Leerzeichen/Tabs). */
function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

/** Leere Zeile oder reiner Kommentar? */
function blankOrComment(line: string): boolean {
  return /^\s*(#.*)?$/.test(line);
}

/**
 * Die `listen`-Zeile direkt unter einem Top-Level-Block (Blockform), nur auf
 * der Einrueckung des ersten Kinds; tiefer eingerueckte Zeilen zaehlen
 * nicht. `lines` ohne BOM. null = Block, Kind oder Zeile fehlt, oder der
 * Block steht in Kurzform (`api: { … }`).
 */
function listenLine(lines: string[], block: string): { index: number; prefix: string; raw: string } | null {
  const head = topKey(block, "\\s*(.*)$");
  let inBlock = false;
  let child = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s#]/.test(line)) {
      if (inBlock) return null; // Block zu Ende, kein listen
      const h = head.exec(line);
      if (h && !blankOrComment(h[1])) return null; // Kurzform
      inBlock = !!h;
      continue;
    }
    if (!inBlock || blankOrComment(line)) continue;
    if (child < 0) child = indentOf(line);
    if (indentOf(line) !== child) continue;
    const m = /^(\s+(?:listen|"listen"|'listen')\s*:)(.*)$/.exec(line);
    if (m) return { index: i, prefix: m[1], raw: m[2] };
  }
  return null;
}

/**
 * Einzeiliger Wert: Text ohne Anfuehrungszeichen und Kommentar. null = leer,
 * `null` oder `~` (go2rtc nimmt dann die Voreinstellung); undefined = kein
 * einfacher Wert (Block-Skalar `|`/`>`, Anker, Alias, Tag, mehrzeilig in
 * Anfuehrungszeichen, Escape), den der Hub nicht anfasst.
 */
function simpleScalar(raw: string): string | null | undefined {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const m = /^"([^"\\]*)"\s*(?:#.*)?$/.exec(v);
    return m ? m[1] : undefined;
  }
  if (v.startsWith("'")) {
    const m = /^'([^']*)'\s*(?:#.*)?$/.exec(v);
    return m ? m[1] : undefined;
  }
  const plain = v.startsWith("#") ? "" : v.replace(/\s+#.*$/, "").trim();
  if (plain === "" || plain === "~" || /^(null|Null|NULL)$/.test(plain)) return null;
  if (/^[|>&*!{[%@`]/.test(plain)) return undefined;
  return plain;
}

/**
 * Legt die go2rtc-API auf 127.0.0.1. Fehlt der Top-Level-Block `api:`, kommt
 * er ans Ende. Steht im Block eine nicht lokale einzeilige `listen`-Zeile
 * (etwa ":1984", auch leer, `null` oder `~`, das heisst fuer go2rtc ":1984"),
 * wird nur ihr Wert ersetzt; der Port bleibt. Ein Block ohne `listen`-Zeile,
 * die Kurzform `api: { … }`, ein mehrzeiliger oder besonderer Wert und eine
 * lokale oder als "" ausgeschaltete Adresse bleiben unveraendert. Gibt null
 * zurueck, wenn nichts zu tun ist.
 */
export function withLoopbackApi(yaml: string): string | null {
  if (!hasTopLevelBlock(yaml, "api")) {
    return append(yaml, `api:\n  listen: "${API_LOOPBACK_HOST}:${GO2RTC_API_PORT}"\n`);
  }
  const bom = yaml.startsWith("\uFEFF") ? "\uFEFF" : "";
  const nl = yaml.includes("\r\n") ? "\r\n" : "\n";
  const lines = yaml.slice(bom.length).split(/\r?\n/);
  const hit = listenLine(lines, "api");
  if (!hit) return null;
  // Folgt eine tiefer eingerueckte Zeile, geht der Wert weiter: nicht anfassen.
  const next = lines.slice(hit.index + 1).find((l) => !blankOrComment(l));
  if (next !== undefined && indentOf(next) > indentOf(lines[hit.index])) return null;
  const value = simpleScalar(hit.raw);
  if (value === undefined) return null;
  const addr = value ?? GO2RTC_API_DEFAULT;
  if (/^\s*["']{2}/.test(hit.raw) || isLoopbackListen(addr)) return null;
  const port = /:(\d{1,5})$/.exec(addr)?.[1] ?? String(GO2RTC_API_PORT);
  lines[hit.index] = `${hit.prefix} "${API_LOOPBACK_HOST}:${port}"`;
  return bom + lines.join(nl);
}

/**
 * Was der Hub an der Datei ergaenzt: RTSP auf Loopback immer, `ffmpeg.bin`
 * nur mit bekanntem Pfad, die API auf Loopback nur mit `apiLoopback`
 * (apiLoopbackAllowed). `added` nennt die Aenderungen (leer = Datei bleibt).
 */
export function planGo2rtcYaml(
  yaml: string,
  ffmpegBin: string | null,
  opts: { apiLoopback?: boolean } = {},
): { yaml: string; added: string[] } {
  const added: string[] = [];
  let out = yaml;
  if (ffmpegBin && !hasFfmpegBlock(out)) {
    out = withFfmpegBin(out, ffmpegBin);
    added.push("ffmpeg");
  }
  if (!hasTopLevelBlock(out, "rtsp")) {
    out = withLoopbackRtsp(out);
    added.push("rtsp");
  }
  if (opts.apiLoopback) {
    const api = withLoopbackApi(out);
    if (api !== null) {
      out = api;
      added.push("api");
    }
  }
  return { yaml: out, added };
}

/**
 * `listen` direkt unter einem Top-Level-Block; null = Block oder Feld fehlt
 * oder der Wert ist leer, `null` oder `~` (go2rtc nimmt dann die
 * Voreinstellung). Nur auf der Einrueckung des ersten Kinds. Liest auch die
 * Kurzform `rtsp: { listen: "…" }`. "" in Anfuehrungszeichen = Server aus.
 */
export function blockListen(yaml: string, block: string): string | null {
  const head = topKey(block, "\\s*(.*)$");
  // BOM vorn weg: JavaScript zaehlt ihn zu \s, die erste Zeile saehe sonst eingerueckt aus.
  const lines = yaml.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const h = /^[^\s#]/.test(line) ? head.exec(line) : null;
    if (!h || !h[1].trim().startsWith("{")) continue;
    const inline = /(?:^|[{,\s])["']?listen["']?\s*:\s*("[^"]*"|'[^']*'|[^,}\s]+)/.exec(h[1]);
    return inline ? (simpleScalar(inline[1]) ?? null) : null;
  }
  const hit = listenLine(lines, block);
  if (!hit) return null;
  return simpleScalar(hit.raw) ?? null;
}

/**
 * Lauscht eine Adresse nur auf diesem Rechner? Leer heisst: Server aus.
 * ":8554", "0.0.0.0:8554" oder eine LAN-Adresse gelten als nicht lokal.
 */
export function isLoopbackListen(addr: string): boolean {
  if (addr === "") return true;
  const host = addr.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

export interface Go2rtcExposure {
  /** Lausch-Adresse der API ("" = aus). */
  api: string;
  /** Lausch-Adresse des RTSP-Servers ("" = aus). */
  rtsp: string;
  apiLocal: boolean;
  rtspLocal: boolean;
}

/** Lausch-Adressen von API und RTSP-Server; ein fehlender Block gilt wie in go2rtc als alle Schnittstellen. */
export function go2rtcExposure(yaml: string): Go2rtcExposure {
  const api = blockListen(yaml, "api") ?? GO2RTC_API_DEFAULT;
  const rtsp = blockListen(yaml, "rtsp") ?? GO2RTC_RTSP_DEFAULT;
  return { api, rtsp, apiLocal: isLoopbackListen(api), rtspLocal: isLoopbackListen(rtsp) };
}

/** Eine Zeile fuers Hub-Log, z. B. „go2rtc: API 127.0.0.1:1984, RTSP 127.0.0.1:8554“. */
export function exposureLine(e: Go2rtcExposure): string {
  const show = (addr: string) => (addr === "" ? "aus" : addr);
  return `go2rtc: API ${show(e.api)}, RTSP ${show(e.rtsp)}`;
}
