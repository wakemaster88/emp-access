import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dgram from "node:dgram";
import { log } from "./config.js";

const exec = promisify(execFile);

export interface HubTask {
  id: number;
  type: string;
  payload: Record<string, unknown> | null;
}

export interface TaskResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Erreichbarkeits-Check per ICMP-Ping (macOS/Linux). */
async function runPing(payload: Record<string, unknown> | null): Promise<TaskResult> {
  const host = String(payload?.host ?? "").trim();
  if (!host || !/^[a-zA-Z0-9.:_-]+$/.test(host)) {
    return { success: false, error: "Ungültiger Host" };
  }
  const started = Date.now();
  try {
    await exec("ping", ["-c", "1", "-W", "2000", host], { timeout: 5000 });
    return { success: true, result: { host, reachable: true, ms: Date.now() - started } };
  } catch {
    return { success: true, result: { host, reachable: false } };
  }
}

/**
 * Netzwerk-Scan ueber die ARP-Tabelle des Rechners. Liefert IP/MAC-Paare des
 * lokalen Segments. (Bewusst passiv - ein aktiver nmap-Sweep kann spaeter als
 * eigenes Modul dazukommen.)
 */
async function runNetworkScan(): Promise<TaskResult> {
  try {
    const { stdout } = await exec("arp", ["-a"], { timeout: 15000 });
    const devices: { ip: string; mac: string; iface: string | null }[] = [];
    for (const line of stdout.split("\n")) {
      // macOS: "? (192.168.1.4) at 8c:3b:ad:65:b1:0 on en0 ifscope [ethernet]"
      const m = line.match(/\(([\d.]+)\) at ([0-9a-fA-F:]+) (?:on (\S+))?/);
      if (!m || m[2] === "ff:ff:ff:ff:ff:ff") continue;
      // MAC-Oktette auf 2 Stellen normalisieren (macOS kuerzt fuehrende Nullen).
      const mac = m[2].split(":").map((o) => o.padStart(2, "0")).join(":").toUpperCase();
      devices.push({ ip: m[1], mac, iface: m[3] ?? null });
    }
    return { success: true, result: { count: devices.length, devices } };
  } catch (e) {
    return { success: false, error: `arp fehlgeschlagen: ${e instanceof Error ? e.message : e}` };
  }
}

/** Wake-on-LAN Magic Packet an die Broadcast-Adresse senden. */
async function runWakeOnLan(payload: Record<string, unknown> | null): Promise<TaskResult> {
  const mac = String(payload?.mac ?? "").replace(/[^0-9a-fA-F]/g, "");
  if (mac.length !== 12) return { success: false, error: "Ungültige MAC-Adresse" };

  const macBytes = Buffer.from(mac, "hex");
  const packet = Buffer.concat([
    Buffer.alloc(6, 0xff),
    ...Array.from({ length: 16 }, () => macBytes),
  ]);

  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", (e) => {
      socket.close();
      resolve({ success: false, error: e.message });
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 9, "255.255.255.255", (err) => {
        socket.close();
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true, result: { mac, sent: true } });
      });
    });
  });
}

export async function executeTask(task: HubTask): Promise<TaskResult> {
  log(`Task #${task.id} (${task.type}) wird ausgeführt …`);
  switch (task.type) {
    case "PING":
      return runPing(task.payload);
    case "NETWORK_SCAN":
      return runNetworkScan();
    case "WAKE_ON_LAN":
      return runWakeOnLan(task.payload);
    default:
      return { success: false, error: `Unbekannter Task-Typ: ${task.type}` };
  }
}
