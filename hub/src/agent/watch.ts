/**
 * Waechter: sammelt alle paar Minuten Befunde aus dem Hub-Zustand.
 *
 * Nur, was die Cloud nicht ohnehin meldet (Hub offline, Geraet offline und
 * Switch-Befunde kommen schon als Push/Alarm-Telegram). Hier: Kameras und
 * DoorBird aus Sicht des Hubs, Speicher/Platte des Macs, Tracker, Soundweb,
 * Gesichtserkennung, das Bildmodell des Waechters und die Cloud-Verbindung
 * selbst.
 */
import { STATE } from "../state.js";
import { listCameraStatus } from "../cameras.js";
import { listDoorbirdStatus } from "../doorbird.js";
import { systemMetrics } from "../system-metrics.js";
import { soundwebSummary } from "../soundweb.js";
import { cameraUnreachableTitle, faceNotReadyDue, type Finding } from "./findings.js";
import { undeliveredAlarms } from "./dispatch.js";
import { LLM, VISION } from "./ollama.js";
import { visionFinding } from "./vision-rules.js";
export { berlinHour, inQuietHours } from "./quiet.js";

/**
 * Erste Minuten nach dem Start des Hubs (Sekunden): Module laden noch, eine
 * Pruefung waere nur Rauschen. So lange gibt es keine Befunde, und der
 * Zustands-Waechter prueft nicht (agent.ts, watchTick): Ein nach dem Neustart
 * uebernommener Stand bleibt bis zur ersten echten Pruefung, wie er ist.
 */
export const WATCH_WARMUP_S = 300;

/**
 * Befunde aus dem Hub-Zustand. `open` sind die Schluessel der Befunde, die
 * schon gemeldet sind (auch aus dem Stand vor einem Neustart). `sentinel`:
 * Der Waechter mit Bildern ist eingeschaltet; dann ist ein Ausfall des
 * Bildmodells ein Alarm und wird bei der naechsten Pruefung gemeldet.
 */
export function collectFindings(now = Date.now(), open: ReadonlySet<string> = new Set(), sentinel = false): Finding[] {
  const out: Finding[] = [];
  const uptimeMin = process.uptime() / 60;
  if (uptimeMin < WATCH_WARMUP_S / 60) return out;

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
      out.push({ key: `cam:${c.id}`, severity: "warn", title: cameraUnreachableTitle(c.name), detail: `${c.host}${c.lastError ? ` · ${c.lastError}` : ""}` });
    }
  }
  for (const d of listDoorbirdStatus()) {
    if (!d.connected) out.push({ key: `doorbird:${d.id}`, severity: "warn", title: `DoorBird ${d.name} getrennt`, detail: d.host });
  }

  const m = systemMetrics();
  // systemMetrics() liefert Prozent (0–100), nicht Anteile. Vorher Schwelle
  // 0,92 und ×100: Warnung bei jedem Stand, z. B. „Arbeitsspeicher 4316 %“.
  if (m.memory.usage > 92) {
    out.push({ key: "ram", severity: "warn", title: `Arbeitsspeicher des Hubs bei ${Math.round(m.memory.usage)} %` });
  }
  if (m.disk && m.disk.usage > 90) {
    out.push({ key: "disk", severity: "warn", title: `Platte des Hubs bei ${Math.round(m.disk.usage)} %` });
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

  if (faceNotReadyDue(STATE.face.ready, uptimeMin, open.has("face"))) {
    out.push({ key: "face", severity: "warn", title: "Gesichtserkennung (Face-Sidecar) nicht bereit" });
  }

  // Bildmodell: nicht bereit, oder es beantwortet die Aufrufe nicht (vision-rules.ts).
  const vision = visionFinding({
    enabled: VISION.enabled,
    sentinel,
    ready: VISION.ready,
    sinceMs: now - VISION.since,
    // Solange das Sprachmodell eingerichtet wird, wartet das Bildmodell darauf (ollama.ts).
    installing: VISION.installing || LLM.installing,
    error: VISION.error,
    failStreak: VISION.failStreak,
    lastError: VISION.lastError,
  });
  if (vision) out.push(vision);

  // Alarme des Waechters mit Bildern, die keinen Chat erreicht haben.
  const lost = undeliveredAlarms(now);
  if (lost) out.push(lost);
  return out;
}

export function berlinHHMM(d = new Date()): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
