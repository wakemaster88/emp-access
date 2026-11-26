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

/**
 * Was der Hub an der Datei ergaenzt: RTSP auf Loopback immer, `ffmpeg.bin`
 * nur mit bekanntem Pfad. `added` nennt die neuen Bloecke (leer = Datei bleibt).
 */
export function planGo2rtcYaml(yaml: string, ffmpegBin: string | null): { yaml: string; added: string[] } {
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
  return { yaml: out, added };
}

/** Wert ohne Anfuehrungszeichen und ohne Kommentar am Zeilenende. */
function scalar(raw: string): string {
  const v = raw.trim();
  const q = /^"([^"]*)"|^'([^']*)'/.exec(v);
  if (q) return q[1] ?? q[2] ?? "";
  return v.replace(/\s+#.*$/, "").trim();
}

/**
 * `listen` direkt unter einem Top-Level-Block; null = Block oder Feld fehlt.
 * Liest auch die Kurzform `rtsp: { listen: "…" }`.
 */
export function blockListen(yaml: string, block: string): string | null {
  const head = topKey(block, "\\s*(.*)$");
  let inBlock = false;
  // BOM vorn weg: JavaScript zaehlt ihn zu \s, die erste Zeile saehe sonst eingerueckt aus.
  for (const line of yaml.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^[^\s#]/.test(line)) {
      const h = head.exec(line);
      inBlock = !!h;
      const inline = h ? /(?:^|[{,\s])["']?listen["']?\s*:\s*("[^"]*"|'[^']*'|[^,}\s]+)/.exec(h[1]) : null;
      if (inline && h && h[1].trim().startsWith("{")) return scalar(inline[1]);
      continue;
    }
    if (!inBlock) continue;
    const m = /^\s+(?:listen|"listen"|'listen')\s*:(.*)$/.exec(line);
    if (m) return scalar(m[1]);
  }
  return null;
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
