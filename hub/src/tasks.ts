import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dgram from "node:dgram";
import os from "node:os";
import { log, api } from "./config.js";
import {
  uploadSnapshot,
  captureSnapshot,
  ptzControl,
  setSpotlight,
  setIrLights,
  setSiren,
  getPtzPresets,
} from "./cameras.js";
import { enrollFromSighting } from "./face.js";
import {
  openDoorbirdDoor,
  isDoorbird,
  uploadDoorbirdSnapshot,
  captureDoorbirdSnapshot,
} from "./doorbird.js";

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
 * Aktiver Ping-Sweep ueber alle lokalen /24-Subnetze. Der Zweck ist nicht die
 * ICMP-Antwort, sondern das Fuellen der ARP-Tabelle: Schon die ARP-Anfrage
 * erzeugt einen Eintrag, auch wenn das Geraet Ping blockiert. Ohne Sweep
 * enthaelt die ARP-Tabelle nur Geraete, mit denen der Rechner selbst
 * kommuniziert hat - Switches/APs fehlen dann fast immer.
 */
async function pingSweep(): Promise<void> {
  const targets: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      // Nur klassische private /24-Netze sweepen (254 Hosts sind vertretbar).
      if (!iface.netmask.endsWith("255.255.255.0")) continue;
      const base = iface.address.split(".").slice(0, 3).join(".");
      for (let i = 1; i <= 254; i++) targets.push(`${base}.${i}`);
    }
  }
  if (targets.length === 0) return;

  const CONCURRENCY = 50;
  let index = 0;
  async function worker() {
    while (index < targets.length) {
      const ip = targets[index++];
      // 1 Paket, 1s Timeout - Fehler sind egal, der ARP-Eintrag zaehlt.
      await exec("ping", ["-c", "1", "-W", "1000", "-n", "-q", ip], { timeout: 3000 }).catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/**
 * Netzwerk-Scan: aktiver Ping-Sweep zum Fuellen der ARP-Tabelle, danach
 * Auslesen der IP/MAC-Paare des lokalen Segments.
 */
export async function runNetworkScan(): Promise<TaskResult> {
  try {
    await pingSweep();
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
    case "CAMERA_SNAPSHOT": {
      const cameraId = Number(task.payload?.cameraId);
      if (!Number.isInteger(cameraId)) return { success: false, error: "cameraId fehlt" };
      try {
        const r = isDoorbird(cameraId)
          ? await uploadDoorbirdSnapshot(cameraId)
          : await uploadSnapshot(cameraId);
        return { success: true, result: { cameraId, ...r } };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case "SCAN_SNAPSHOT": {
      // Kamerabild zum Scan-Zeitpunkt: Bild aufnehmen und zur Zuordnung an
      // die Cloud schicken (dort wird der zeitlich naechste Scan gesucht).
      const cameraId = Number(task.payload?.cameraId);
      const deviceId = Number(task.payload?.deviceId);
      const at = String(task.payload?.at ?? "");
      if (!Number.isInteger(cameraId) || !Number.isInteger(deviceId)) {
        return { success: false, error: "cameraId/deviceId fehlt" };
      }
      // Verspaetet abgeholte Tasks (Hub war offline/Neustart) nicht mehr
      // ausfuehren: Ein Bild Minuten nach dem Scan zeigt die falsche Person.
      if (at && Date.now() - new Date(at).getTime() > 30_000) {
        return { success: true, result: { skipped: "stale", at } };
      }
      try {
        const buf = isDoorbird(cameraId)
          ? await captureDoorbirdSnapshot(cameraId)
          : await captureSnapshot(cameraId);
        const params = new URLSearchParams({
          cameraId: String(cameraId),
          deviceId: String(deviceId),
          ...(at ? { at } : {}),
        });
        const upload = await api(`/api/hub/scan-snapshots?${params}`, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: new Uint8Array(buf),
        });
        if (!upload.ok) {
          return { success: false, error: `Upload fehlgeschlagen: HTTP ${upload.status}` };
        }
        const data = (await upload.json().catch(() => ({}))) as { scanId?: number };
        return { success: true, result: { cameraId, deviceId, bytes: buf.length, scanId: data.scanId ?? null } };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case "FACE_ENROLL": {
      const sightingId = Number(task.payload?.sightingId);
      const listedPersonId = Number(task.payload?.listedPersonId);
      if (!Number.isInteger(sightingId) || !Number.isInteger(listedPersonId)) {
        return { success: false, error: "sightingId/listedPersonId fehlt" };
      }
      const r = await enrollFromSighting(sightingId, listedPersonId);
      if (!r.ok) return { success: false, error: r.error ?? "Enroll fehlgeschlagen" };
      return { success: true, result: r };
    }
    case "CAMERA_PTZ":
    case "CAMERA_SPOTLIGHT":
    case "CAMERA_IR":
    case "CAMERA_SIREN":
    case "CAMERA_PTZ_PRESETS": {
      const cameraId = Number(task.payload?.cameraId);
      if (!Number.isInteger(cameraId)) return { success: false, error: "cameraId fehlt" };
      try {
        let result: unknown;
        switch (task.type) {
          case "CAMERA_PTZ":
            result = await ptzControl(cameraId, task.payload);
            break;
          case "CAMERA_SPOTLIGHT":
            result = await setSpotlight(cameraId, task.payload);
            break;
          case "CAMERA_IR":
            result = await setIrLights(cameraId, task.payload);
            break;
          case "CAMERA_SIREN":
            result = await setSiren(cameraId, task.payload);
            break;
          default:
            result = await getPtzPresets(cameraId);
        }
        return { success: true, result: { cameraId, ...(result as object) } };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case "DOORBIRD_OPEN": {
      const cameraId = Number(task.payload?.cameraId);
      if (!Number.isInteger(cameraId)) return { success: false, error: "cameraId fehlt" };
      const relay = Number(task.payload?.relay) || 1;
      const r = await openDoorbirdDoor(cameraId, relay);
      if (!r.ok) return { success: false, error: r.error ?? "Türöffner fehlgeschlagen" };
      return { success: true, result: { cameraId, relay, opened: true } };
    }
    default:
      return { success: false, error: `Unbekannter Task-Typ: ${task.type}` };
  }
}
