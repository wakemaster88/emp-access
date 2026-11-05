/**
 * Erkannte Personen live in der Kamera-Zentrale.
 *
 *  - personBoxes(): Personen-Boxen im aktuellen Bild einer Kamera (YOLO im
 *    Tracker, POST /classify → persons). Nur auf Anfrage der geoeffneten
 *    Grossansicht, hoechstens etwa einmal pro Sekunde und Kamera.
 *  - seenPeople(): Wer wurde gerade wo gesehen? Aus der Gesichtserkennung
 *    (Hub-Ereignis kind "person"), dem Waechter des Assistenten
 *    („Assistent: vermutlich Mitarbeiter“ / „Assistent: auffällig“), seiner
 *    kameraübergreifenden Wiedererkennung (activeCleared) und der Personen-
 *    Erkennung der Kameras selbst (Zustand PERSON).
 *
 * Bilder und Boxen werden nicht gespeichert.
 */
import { log } from "./config.js";
import { getFrame } from "./frame-cache.js";
import { listCameraStatus } from "./cameras.js";
import { listDoorbirdStatus } from "./doorbird.js";
import { hubEventsSince } from "./state.js";
import { trackerBaseUrl } from "./vision.js";
import { restartService } from "./services.js";
import { activeCleared } from "./agent/people.js";
import { personLabel, mergeSeen, type SeenKind, type SeenPerson, type SeenSource } from "./live-people-rules.js";

export type { SeenPerson };

export interface PersonBox {
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LiveBoxes {
  cameraId: number;
  at: string;
  /** null = Tracker nicht erreichbar oder liefert (noch) keine Boxen. */
  persons: PersonBox[] | null;
  /** Anzahl laut Tracker, auch wenn er keine Boxen kennt. */
  people: number;
  /** Wer das vermutlich ist (Gesicht, Waechter), sonst null. */
  label: { text: string; kind: SeenKind } | null;
  /** Bild war aelter als 3 s (go2rtc lieferte kein frisches). */
  stale: boolean;
}

const MIN_INTERVAL_MS = 800;
const cache = new Map<number, { at: number; value: Promise<LiveBoxes> }>();
let trackerRestartTried = false;

async function classify(jpeg: Buffer): Promise<{ persons: PersonBox[] | null; people: number } | null> {
  const url = await trackerBaseUrl();
  const res = await fetch(`${url}/classify`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(jpeg),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as { people?: number; persons?: PersonBox[] } | null;
  if (!json) return null;
  const people = Number(json.people) || 0;
  if (!Array.isArray(json.persons)) {
    // Tracker laeuft noch mit altem Code (kein Neustart nach dem Update):
    // einmal pro Hub-Prozess neu starten, dann kommen die Boxen.
    if (!trackerRestartTried) {
      trackerRestartTried = true;
      log("Live-Personen: Tracker kennt noch keine Personen-Boxen – starte ihn einmal neu");
      void restartService({ service: "tracker" }).catch(() => undefined);
    }
    return { persons: null, people };
  }
  const persons = json.persons
    .map((p) => ({ conf: Number(p.conf), x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }))
    .filter((p) => [p.conf, p.x, p.y, p.w, p.h].every(Number.isFinite) && p.w > 0 && p.h > 0)
    .slice(0, 20);
  return { persons, people };
}

/** Quellen fuer seenPeople()/Label, juengste zuerst. */
async function sources(windowMs: number): Promise<SeenSource[]> {
  const since = Date.now() - windowMs;
  const out: SeenSource[] = [];
  for (const ev of hubEventsSince(0)) {
    const at = Date.parse(ev.ts);
    if (!ev.where || !(at >= since)) continue;
    if (ev.kind === "person") out.push({ camera: ev.where, at, title: ev.title, list: ev.list ?? null, origin: "face" });
    else if (ev.kind === "camera" && ev.title.startsWith("Assistent:")) {
      out.push({ camera: ev.where, at, title: ev.title, list: null, origin: "sentinel" });
    }
  }
  const cleared = await activeCleared().catch(() => []);
  for (const c of cleared) {
    if (c.at >= since) out.push({ camera: c.camera, at: c.at, title: c.label, list: null, origin: "cleared" });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Personen-Boxen im aktuellen Bild der Kamera. `src` ist der go2rtc-Stream, den die Ansicht abspielt. */
export function personBoxes(go2rtcUrl: string, cameraId: number, cameraName: string, src: string): Promise<LiveBoxes> {
  const hit = cache.get(cameraId);
  if (hit && Date.now() - hit.at < MIN_INTERVAL_MS) return hit.value;
  const value = (async (): Promise<LiveBoxes> => {
    const got = await getFrame(go2rtcUrl, src, false);
    const at = new Date().toISOString();
    const recent = await sources(3 * 60_000);
    const label = personLabel(recent.filter((s) => s.camera === cameraName));
    if (!got) return { cameraId, at, persons: null, people: 0, label, stale: true };
    const r = await classify(got.frame.buf);
    return {
      cameraId,
      at,
      persons: r?.persons ?? null,
      people: r?.people ?? 0,
      label,
      stale: got.cached || Date.now() - got.frame.at > 3000,
    };
  })();
  cache.set(cameraId, { at: Date.now(), value });
  value.catch(() => cache.delete(cameraId));
  return value;
}

/** Wer wurde in den letzten Minuten wo gesehen? Eine Zeile je Kamera, juengste zuerst. */
export async function seenPeople(windowMs = 15 * 60_000): Promise<SeenPerson[]> {
  const cams = [
    ...listCameraStatus().map((c) => ({ id: c.id, name: c.name, person: c.activeStates.includes("PERSON") })),
    ...listDoorbirdStatus().map((b) => ({ id: b.id, name: b.name, person: false })),
  ];
  return mergeSeen(cams, await sources(windowMs), Date.now());
}
