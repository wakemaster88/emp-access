import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dgram from "node:dgram";
import { log, api } from "./config.js";
import {
  uploadSnapshot,
  captureSnapshot,
  ptzControl,
  setSpotlight,
  setIrLights,
  setSiren,
  getPtzPresets,
  ensureCameraConfigs,
} from "./cameras.js";
import { enrollFromSighting } from "./face.js";
import { readHubLog } from "./hublog.js";
import { restartService } from "./services.js";
import { checkSystem } from "./system-setup.js";
import { DISPLAY_SNAPSHOT_MAX_PX, shrinkJpeg } from "./image.js";
import {
  openDoorbirdDoor,
  setDoorbirdHold,
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
 * Netzwerk-Scan: nutzt denselben Ping-Sweep + Portscan + Cloud-Upload
 * wie der Intervall-Auto-Scan (aktualisiert „Geräte“ in der UI).
 */
export async function runNetworkScan(): Promise<TaskResult> {
  const { runCloudScan } = await import("./scanner.js");
  const r = await runCloudScan("Netzwerk-Scan");
  if (!r.ok) {
    return { success: false, error: r.error ?? "Scan fehlgeschlagen", result: r };
  }
  return { success: true, result: r };
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
    case "SWITCH_SYNC": {
      const { runSwitchSync } = await import("./snmp.js");
      const r = await runSwitchSync("SWITCH_SYNC");
      if (!r.ok) return { success: false, error: r.error ?? "SNMP fehlgeschlagen", result: r };
      return { success: true, result: r };
    }
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
        const raw = isDoorbird(cameraId)
          ? await captureDoorbirdSnapshot(cameraId)
          : await captureSnapshot(cameraId);
        // Fuer die Anzeige reicht 1280 px; das spart Upload und Speicher in der Cloud.
        const buf = await shrinkJpeg(raw, DISPLAY_SNAPSHOT_MAX_PX);
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
      if (!isDoorbird(cameraId)) await ensureCameraConfigs();
      const r = await openDoorbirdDoor(cameraId, relay);
      if (!r.ok) return { success: false, error: r.error ?? "Türöffner fehlgeschlagen" };
      return { success: true, result: { cameraId, relay, opened: true } };
    }
    case "DOORBIRD_HOLD": {
      // Tor offen halten: payload.until (ISO) = bis dahin im Takt pulsen,
      // null = beenden. Der Task schlaegt nur fehl, wenn die DoorBird hier
      // unbekannt ist – ein fehlgeschlagener erster Impuls wird gemeldet,
      // die Schleife versucht es weiter (Cloud zeigt den Fehler an).
      const cameraId = Number(task.payload?.cameraId);
      if (!Number.isInteger(cameraId)) return { success: false, error: "cameraId fehlt" };
      const rawUntil = task.payload?.until;
      const until = typeof rawUntil === "string" && rawUntil ? rawUntil : null;
      const relay = Number(task.payload?.relay) || 1;
      if (!isDoorbird(cameraId)) await ensureCameraConfigs();
      const r = await setDoorbirdHold(cameraId, until, { relay, source: "task" });
      if (!r.ok) return { success: false, error: r.error ?? "Offen halten fehlgeschlagen" };
      return { success: true, result: { cameraId, ...r.state } };
    }
    case "HUB_LOG": {
      // Log-Ausschnitt in die Cloud liefern (Netzwerk → Lokaler Hub → „Log abrufen“).
      const result = await readHubLog(task.payload);
      return { success: true, result };
    }
    case "SERVICE_RESTART":
      // Tracker per launchctl, Hub per Exit (launchd startet neu) – feste Liste, kein freier Befehl.
      return restartService(task.payload);
    case "SYSTEM_CHECK": {
      // Auto-Login/Ruhezustand/Einschaltplan sofort neu lesen (z. B. nach setup-system.sh),
      // pmset dabei nachziehen, falls die sudoers-Regel inzwischen da ist.
      const system = await checkSystem();
      if (!system) return { success: false, error: "Systempflege nur auf macOS" };
      return { success: true, result: system };
    }
    default:
      return { success: false, error: `Unbekannter Task-Typ: ${task.type}` };
  }
}
