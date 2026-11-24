/**
 * Lokale Stream-Konfiguration (go2rtc + Kiosk) an die Cloud-Kamera-Liste
 * angleichen. Cloud-Camera ist führend; Dateien sind gitignored, kein Commit.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { isStreamHost, replaceHost } from "./stream-host.js";

const GO2RTC_URL = (process.env.HUB_GO2RTC_URL || "http://127.0.0.1:1984").replace(/\/$/, "");

export interface CloudCameraHost {
  name: string;
  host: string;
  kind?: string;
}

function go2rtcPath() {
  return path.join(CONFIG.repoDir, "webcams", "infra", "go2rtc.yaml");
}

function kioskPath() {
  return path.join(CONFIG.repoDir, "webcams", "config.json");
}

async function rewriteFile(file: string, oldIp: string, newIp: string): Promise<number> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return 0;
  }
  const { text: replaced, count } = replaceHost(text, oldIp, newIp);
  if (count === 0) return 0;
  await fs.writeFile(file, replaced, "utf8");
  return count;
}

async function restartGo2rtc(): Promise<boolean> {
  try {
    const res = await fetch(`${GO2RTC_URL}/api/restart`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Abgelehnte Adresswechsel nur einmal je Prozesslauf protokollieren, weil
// der Cloud-Abgleich regelmäßig läuft.
const rejectedLogged = new Set<string>();

async function applyIpChange(oldIp: string, newIp: string, label = ""): Promise<number> {
  if (!oldIp || !newIp || oldIp === newIp) return 0;
  // Nur reine IPv4-Adressen oder Hostnamen in die Dateien schreiben.
  if (!isStreamHost(oldIp) || !isStreamHost(newIp)) {
    const key = `${label}|${oldIp}|${newIp}`;
    if (!rejectedLogged.has(key)) {
      rejectedLogged.add(key);
      log(
        `Stream-Konfig nicht angepasst${label ? ` (Kamera ${label})` : ""}: ` +
          `${JSON.stringify(oldIp)} → ${JSON.stringify(newIp)} ist keine IPv4 bzw. kein Hostname`
      );
    }
    return 0;
  }
  let total = 0;
  for (const file of [go2rtcPath(), kioskPath()]) {
    try {
      const count = await rewriteFile(file, oldIp, newIp);
      if (count > 0) {
        total += count;
        log(`Stream-Konfig ${path.basename(file)}: ${count}× ${oldIp} → ${newIp}`);
      }
    } catch (e) {
      log(`Stream-Konfig ${path.basename(file)} nicht anpassbar: ${e instanceof Error ? e.message : e}`);
    }
  }
  return total;
}

/**
 * Alte IP in go2rtc-/Kiosk-Konfiguration durch die neue ersetzen und go2rtc
 * neu laden. Kein git – die Dateien sind lokal und gitignored.
 */
export async function updateLocalStreams(oldIp: string, newIp: string): Promise<boolean> {
  const total = await applyIpChange(oldIp, newIp);
  if (total === 0) return false;
  const restarted = await restartGo2rtc();
  log(
    restarted
      ? `go2rtc neu geladen (${oldIp} → ${newIp})`
      : `go2rtc-Neustart fehlgeschlagen – Streams laufen ggf. bis zum naechsten Neustart auf der alten IP`
  );
  return true;
}

/**
 * Cloud-Kamera-Hosts in die lokale Kiosk-/go2rtc-Config spiegeln (Name oder
 * aktuelle IP als Schlüssel). Zusätzliche Kiosk-Cams bleiben unangetastet.
 */
export async function syncLocalStreamsFromCloud(cameras: CloudCameraHost[]): Promise<void> {
  let cfg: {
    cams?: Array<{ name?: string; ip?: string }>;
    doorbird?: { enabled?: boolean; ip?: string };
  };
  try {
    cfg = JSON.parse(await fs.readFile(kioskPath(), "utf8")) as typeof cfg;
  } catch {
    return;
  }

  const changes: Array<{ oldIp: string; newIp: string; label: string }> = [];
  const cams = Array.isArray(cfg.cams) ? cfg.cams : [];

  for (const cloud of cameras) {
    const host = String(cloud.host ?? "").trim();
    const name = String(cloud.name ?? "").trim().toLowerCase();
    if (!host) continue;

    if (cloud.kind === "DOORBIRD" && cfg.doorbird?.ip && cfg.doorbird.ip !== host) {
      changes.push({ oldIp: cfg.doorbird.ip, newIp: host, label: String(cloud.name ?? "") });
      continue;
    }

    const match =
      cams.find((c) => String(c.ip ?? "") === host) ??
      cams.find((c) => String(c.name ?? "").trim().toLowerCase() === name);
    if (!match) continue;
    const oldIp = String(match.ip ?? "").trim();
    if (oldIp && oldIp !== host) {
      changes.push({ oldIp, newIp: host, label: String(cloud.name ?? "") });
    }
  }

  let total = 0;
  for (const { oldIp, newIp, label } of changes) {
    total += await applyIpChange(oldIp, newIp, label);
  }
  if (total === 0) return;
  const restarted = await restartGo2rtc();
  log(
    restarted
      ? `go2rtc nach Cloud-Sync neu geladen (${changes.length} Hosts)`
      : `go2rtc-Neustart nach Cloud-Sync fehlgeschlagen`
  );
}
