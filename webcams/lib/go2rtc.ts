import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Cam, Config, DoorbirdConfig } from "./types";

const WEBRTC_PORT = 8555;

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

export function buildGo2rtcYaml(config: Config): string {
  const lines: string[] = [];
  lines.push("# AUTO-GENERIERT von /admin – nicht manuell editieren.");
  lines.push("# Manuelle Anpassungen bitte in der UI vornehmen.");
  lines.push("");
  lines.push("api:");
  lines.push('  listen: ":1984"');
  lines.push('  origin: "*"');
  lines.push("");
  lines.push("log:");
  lines.push("  level: info");
  lines.push("");
  // Reines LAN-Setup: explizite Host-Kandidaten statt Public-STUN.
  // Das spart pro Stream einen STUN-Roundtrip ins Internet und macht den
  // WebRTC-Verbindungsaufbau spürbar schneller/stabiler.
  lines.push("webrtc:");
  lines.push("  candidates:");
  lines.push(`    - 127.0.0.1:${WEBRTC_PORT}`);
  for (const ip of lanIPv4Addresses()) {
    lines.push(`    - ${ip}:${WEBRTC_PORT}`);
  }
  lines.push("");
  lines.push("streams:");

  for (const cam of config.cams) {
    if (!cam.enabled) continue;
    lines.push(`  ${cam.id}_main:`);
    lines.push(`    - ${quoteYaml(rtspUrl(cam, cam.streamMain))}`);
    lines.push(`  ${cam.id}_sub:`);
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

export async function writeGo2rtcYaml(config: Config): Promise<string> {
  const yaml = buildGo2rtcYaml(config);
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
