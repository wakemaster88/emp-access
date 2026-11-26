import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Cam, Config, DoorbirdConfig } from "./types";

const WEBRTC_PORT = 8555;
/** go2rtc-API (Signalisierung, Config, Restart) — bewusst nur Loopback. */
export const GO2RTC_API_LISTEN = "127.0.0.1:1984";
/** RTSP-Server von go2rtc: nur Loopback, der Tracker liest lokal. */
export const GO2RTC_RTSP_LISTEN = "127.0.0.1:8554";

/**
 * Liefert alle nicht-internen IPv4-Adressen des Hosts. Werden als explizite
 * ICE-Kandidaten in go2rtc eingetragen, damit Browser im LAN direkt verbinden,
 * ohne den Umweg über einen STUN-Server (schnellerer Verbindungsaufbau).
 */
function lanIPv4Addresses(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return [...new Set(out)];
}

const GO2RTC_PATH =
  process.env.WEBCAMS_GO2RTC_YAML ??
  path.join(process.cwd(), "infra", "go2rtc.yaml");

function rtspUrl(cam: Cam, stream: string) {
  const auth = `${encodeURIComponent(cam.username)}:${encodeURIComponent(cam.password)}`;
  return `rtsp://${auth}@${cam.ip}:${cam.rtspPort}/${stream}`;
}

function quoteYaml(s: string) {
  // YAML simple quoting: wrap in double quotes and escape \ and "
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Stream-Name als YAML-Schlüssel. Übliche IDs bleiben unverändert; alles
 * andere (z. B. ältere IDs mit Leerzeichen) wird als JSON-String geschrieben,
 * der auch ein gültiger YAML-String in doppelten Anführungszeichen ist.
 */
export function yamlKey(name: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(name) ? name : JSON.stringify(name);
}

/**
 * Top-Level-Block `ffmpeg:` aus einer vorhandenen go2rtc.yaml, samt seiner
 * eingerückten Zeilen; null = keiner. Den Block (`ffmpeg: bin: <pfad>`)
 * trägt der Hub ein (hub/src/ffmpeg-setup.ts); beim Neuschreiben bleibt er
 * so erhalten, und der Hub muss go2rtc nicht ein zweites Mal neu starten.
 * Liest auch `"ffmpeg":`, `'ffmpeg':` und einen BOM vor der ersten Zeile.
 */
export function existingFfmpegBlock(yaml: string): string | null {
  const lines = yaml.replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^(?:"ffmpeg"|'ffmpeg'|ffmpeg)\s*:/.test(l));
  if (start < 0) return null;
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    // Nächster Top-Level-Schlüssel oder Kommentar am Zeilenanfang: Block zu Ende.
    if (/^[^\s]/.test(line)) break;
    block.push(line);
  }
  while (block.length > 1 && block[block.length - 1].trim() === "") block.pop();
  return block.join("\n");
}

/**
 * Baut die go2rtc.yaml. `keep.ffmpeg`: ein vorhandener `ffmpeg:`-Block
 * (siehe `existingFfmpegBlock`), der unverändert mitgeschrieben wird.
 */
export function buildGo2rtcYaml(config: Config, keep: { ffmpeg?: string | null } = {}): string {
  const lines: string[] = [];
  lines.push("# AUTO-GENERIERT von /admin – nicht manuell editieren.");
  lines.push("# Manuelle Anpassungen bitte in der UI vornehmen.");
  lines.push("");
  // API nur auf Loopback: `/api/config` und `/api/streams` liefern die
  // RTSP-URLs samt Kamera-/DoorBird-Passwörtern im Klartext, und go2rtc hat
  // hier keine eigene Anmeldung – im LAN darf sie nicht erreichbar sein. Alle
  // Clients laufen auf diesem Rechner (Next-Server, Hub, Sidecar); das
  // Kiosk-Dashboard spricht über die Next-App (`/api/go2rtc/webrtc`,
  // `/api/go2rtc/frame.jpeg`). Das Video selbst läuft weiter direkt über den
  // WebRTC-Port unten.
  //
  // `origin: "*"` bleibt vorerst: Die Kamera-Seite der Cloud-App
  // (emp-access /webcams) fragt go2rtc direkt aus dem Browser dieses Rechners
  // ab und braucht dafür CORS. Sobald sie über den Hub-Proxy läuft, kann die
  // Zeile entfallen (dann kann auch keine lokal geöffnete Fremdseite die API
  // mehr auslesen).
  lines.push("api:");
  lines.push(`  listen: "${GO2RTC_API_LISTEN}"`);
  lines.push('  origin: "*"');
  lines.push("");
  lines.push("log:");
  lines.push("  level: info");
  lines.push("");
  // RTSP-Server von go2rtc nur über 127.0.0.1: Einziger Abnehmer ist der
  // Tracker auf diesem Rechner (WEBCAMS_TRACKER_RTSP_BASE =
  // rtsp://127.0.0.1:8554). Der Hub ergänzt den Block auch in Dateien eines
  // älteren Kiosk-Stands (hub/src/ffmpeg-setup.ts).
  lines.push("rtsp:");
  lines.push(`  listen: "${GO2RTC_RTSP_LISTEN}"`);
  lines.push("");
  if (keep.ffmpeg) {
    // Vom Hub eingetragen (ffmpeg-Pfad für Standbilder), bleibt beim Neuschreiben.
    lines.push(keep.ffmpeg);
    lines.push("");
  }
  // Reines LAN-Setup: explizite Host-Kandidaten statt Public-STUN.
  // Das spart pro Stream einen STUN-Roundtrip ins Internet und macht den
  // WebRTC-Verbindungsaufbau spürbar schneller/stabiler.
  // go2rtc fragt ohne ice_servers trotzdem Googles Public-STUN an. Antwortet
  // der nicht, wartet jede Verbindung ~5 s (2026-11-08 auf dem Mac Studio:
  // Kacheln der Zentrale blieben bis zu einer Minute schwarz). Leere Liste
  // schaltet STUN ganz ab.
  lines.push("webrtc:");
  lines.push("  ice_servers: []");
  lines.push("  candidates:");
  lines.push(`    - 127.0.0.1:${WEBRTC_PORT}`);
  for (const ip of lanIPv4Addresses()) {
    lines.push(`    - ${ip}:${WEBRTC_PORT}`);
  }
  lines.push("");
  lines.push("streams:");

  for (const cam of config.cams) {
    if (!cam.enabled) continue;
    lines.push(`  ${yamlKey(`${cam.id}_main`)}:`);
    lines.push(`    - ${quoteYaml(rtspUrl(cam, cam.streamMain))}`);
    lines.push(`  ${yamlKey(`${cam.id}_sub`)}:`);
    lines.push(`    - ${quoteYaml(rtspUrl(cam, cam.streamSub))}`);
  }

  if (config.doorbird.enabled && config.doorbird.ip) {
    const db: DoorbirdConfig = config.doorbird;
    const auth = `${encodeURIComponent(db.username)}:${encodeURIComponent(db.password)}`;
    lines.push(`  doorbird:`);
    lines.push(`    - ${quoteYaml(`rtsp://${auth}@${db.ip}:554/mpeg/media.amp`)}`);
    lines.push(`    - ${quoteYaml(`doorbird://${auth}@${db.ip}`)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Gültiger go2rtc-Stream-Name (`<camId>_main`, `<camId>_sub`, `doorbird`)?
 * Hält alles fern, was die weitergereichte URL verändern könnte.
 */
export function isValidStreamName(src: string): boolean {
  return /^[^\s/?#&]{1,120}$/.test(src);
}

/**
 * Server-seitige URL zur go2rtc-API, z. B. `/api/webrtc?src=…`.
 * Ohne konfigurierte go2rtc-URL gilt der Standard — wie zuvor im Dashboard.
 */
export function go2rtcApiUrl(
  go2rtcUrl: string | undefined,
  pathAndQuery: string,
): string {
  const base = go2rtcUrl || `http://${GO2RTC_API_LISTEN}`;
  return `${base.replace(/\/$/, "")}${pathAndQuery}`;
}

async function readCurrentYaml(): Promise<string> {
  try {
    return await fs.readFile(GO2RTC_PATH, "utf8");
  } catch {
    return ""; // noch keine Datei
  }
}

export async function writeGo2rtcYaml(config: Config): Promise<string> {
  const yaml = buildGo2rtcYaml(config, { ffmpeg: existingFfmpegBlock(await readCurrentYaml()) });
  await fs.mkdir(path.dirname(GO2RTC_PATH), { recursive: true });
  const tmp = `${GO2RTC_PATH}.tmp`;
  await fs.writeFile(tmp, yaml, "utf8");
  await fs.rename(tmp, GO2RTC_PATH);
  return GO2RTC_PATH;
}

export async function reloadGo2rtc(go2rtcUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${go2rtcUrl.replace(/\/$/, "")}/api/restart`, {
      method: "POST",
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function getGo2rtcYamlPath() {
  return GO2RTC_PATH;
}

/** Prüft ob go2rtc erreichbar ist (für Dashboard-Banner / Health). */
export async function checkGo2rtcReachable(go2rtcUrl: string): Promise<{
  reachable: boolean;
  streams?: string[];
  error?: string;
}> {
  try {
    const r = await fetch(`${go2rtcUrl.replace(/\/$/, "")}/api/streams`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      return { reachable: false, error: `HTTP ${r.status}` };
    }
    const data = (await r.json()) as Record<string, unknown>;
    const keys = Object.keys(data ?? {});
    return { reachable: true, streams: keys };
  } catch (err) {
    return { reachable: false, error: (err as Error).message };
  }
}
