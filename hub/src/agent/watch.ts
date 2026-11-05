/**
 * Waechter: sammelt alle paar Minuten Befunde aus dem Hub-Zustand.
 *
 * Nur, was die Cloud nicht ohnehin meldet (Hub offline, Geraet offline und
 * Switch-Befunde kommen schon als Push/Alarm-Telegram). Hier: Kameras und
 * DoorBird aus Sicht des Hubs, Speicher/Platte des Macs, Tracker, Soundweb,
 * Gesichtserkennung und die Cloud-Verbindung selbst.
 */
import { STATE } from "../state.js";
import { listCameraStatus } from "../cameras.js";
import { listDoorbirdStatus } from "../doorbird.js";
import { systemMetrics } from "../system-metrics.js";
import { soundwebSummary } from "../soundweb.js";
import type { Finding } from "./findings.js";
export { inQuietHours } from "./quiet.js";

export function collectFindings(now = Date.now()): Finding[] {
  const out: Finding[] = [];
  const uptimeMin = process.uptime() / 60;
  // Erste Minuten nach dem Start: Module laden noch, das waere nur Rauschen.
  if (uptimeMin < 5) return out;

  const last = STATE.heartbeat.lastSuccessAt ? Date.parse(STATE.heartbeat.lastSuccessAt) : 0;
  if (now - last > 5 * 60_000) {
    out.push({
      key: "cloud",
      severity: "alert",
      title: "Cloud nicht erreichbar",
      detail: STATE.heartbeat.lastError ?? undefined,
    });
  }

  for (const c of listCameraStatus()) {
    if (!c.reachable) {
      out.push({ key: `cam:${c.id}`, severity: "warn", title: `Kamera ${c.name} nicht erreichbar`, detail: `${c.host}${c.lastError ? ` · ${c.lastError}` : ""}` });
    }
  }
  for (const d of listDoorbirdStatus()) {
    if (!d.connected) out.push({ key: `doorbird:${d.id}`, severity: "warn", title: `DoorBird ${d.name} getrennt`, detail: d.host });
  }

  const m = systemMetrics();
  if (m.memory.usage > 0.92) {
    out.push({ key: "ram", severity: "warn", title: `Arbeitsspeicher des Hubs bei ${Math.round(m.memory.usage * 100)} %` });
  }
  if (m.disk && m.disk.usage > 0.9) {
    out.push({ key: "disk", severity: "warn", title: `Platte des Hubs bei ${Math.round(m.disk.usage * 100)} %` });
  }

  if (STATE.parking.lots > 0 && STATE.parking.lastAt && !STATE.parking.trackerOnline) {
    out.push({ key: "tracker", severity: "warn", title: "Park-/Personen-Tracker offline" });
  }

  const sw = soundwebSummary();
  if (sw.devices > 0 && sw.connected < sw.devices) {
    out.push({
      key: "soundweb",
      severity: "warn",
      title: `Soundweb: ${sw.devices - sw.connected} von ${sw.devices} Prozessoren getrennt`,
      detail: sw.lastError ?? undefined,
    });
  }

  if (uptimeMin > 15 && !STATE.face.ready) {
    out.push({ key: "face", severity: "warn", title: "Gesichtserkennung (Face-Sidecar) nicht bereit" });
  }
  return out;
}

export function berlinHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(d)) % 24;
}

export function berlinHHMM(d = new Date()): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
