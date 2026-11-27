/**
 * Einstellung „Livebild und Vorschau“ je Kamera (Cloud: Camera.liveMode),
 * Regeln ohne Netz und ohne Datei, damit testbar.
 *
 * - "auto" (null, leer oder "AUTO"): wie bisher. Die Zentrale startet das
 *   Livebild von selbst, Bewegung schickt ein Vorschaubild in die Cloud.
 * - "click" ("CLICK"): nur auf Tippen. Kein Vorschaubild in die Cloud, die
 *   Zentrale zeigt das Livebild erst nach einem Tippen.
 * - "off" ("OFF"): aus. Keine Kachel, kein Livebild, kein Vorschaubild.
 *
 * Ein unbekannter Wert gilt wie "click" (die sichere Seite), genau wie in
 * der Cloud (src/lib/camera-live-mode.ts). Eine aeltere Cloud schickt das
 * Feld nicht: dann "auto" wie bisher.
 *
 * Erkennung, Waechter, Tracker und Parkflaeche laufen in jedem Modus weiter;
 * die Einstellung betrifft nur Bilder, die jemand ansieht.
 */

import { isMowerStream } from "./mower-streams.js";

export type LiveMode = "auto" | "click" | "off";

/** Gespeicherten Wert lesen: leer und "AUTO" = auto, unbekannt = click. */
export function readLiveMode(raw: unknown): LiveMode {
  if (raw === null || raw === undefined) return "auto";
  if (typeof raw !== "string") return "click";
  const v = raw.trim().toUpperCase();
  if (v === "" || v === "AUTO") return "auto";
  if (v === "OFF") return "off";
  return "click";
}

/** Darf der Hub ein Vorschaubild dieser Kamera in die Cloud laden? Nur bei „automatisch“. */
export function previewUploadAllowed(raw: unknown): boolean {
  return readLiveMode(raw) === "auto";
}

/** Kamera fuer die Zuordnung der go2rtc-Streams (Reolink und DoorBird). */
export interface LiveModeCamera {
  name: string;
  host: string | null;
  kind?: string | null;
  liveMode?: string | null;
}

/** go2rtc-Stream: Name und Host aus der Quell-URL (StreamSummary). */
export interface LiveStream {
  name: string;
  host: string | null;
}

export interface StreamAccess {
  /** Diese Streams darf die Zentrale abspielen (Livebild, Standbild, Personen-Boxen). */
  allowed: string[];
  /** Gesperrt: Stream einer Kamera mit „aus“ oder, bei bekannter Kamera-Liste, ohne Kamera. */
  denied: string[];
}

const hostKey = (h: string | null | undefined) => (h ?? "").trim().toLowerCase();
const isLocalHost = (h: string) => h === "localhost" || /^127\./.test(h);

/**
 * Welche go2rtc-Streams darf die Zentrale zeigen? Zuordnung wie
 * streamCoverage (go2rtc-status-rules.ts) ueber den Host aus der Quell-URL;
 * Streams ohne Host oder mit lokaler Quelle passen zu keiner Kamera.
 *
 * - Maeher-Streams (`mower_…`) wie bisher: immer erlaubt.
 * - Stream einer Kamera mit „aus“: gesperrt. Teilen sich mehrere Kameras
 *   einen Host (Rekorder mit Kanaelen), gewinnt „aus“.
 * - Stream `doorbird`: passt sein Host zu einer Kamera, gilt nur diese (wie
 *   jeder andere Stream). Sonst gehoert er zu jeder DoorBird ohne eigenen
 *   Stream (wie streamFor in der Zentrale) und ist gesperrt, sobald eine
 *   davon „aus“ ist; gibt es keine solche, ist er gesperrt, wenn irgendeine
 *   DoorBird „aus“ ist, sonst erlaubt wie bisher.
 * - Andere Streams ohne Kamera: gesperrt, sobald die Kamera-Liste bekannt
 *   (nicht leer) ist; ohne Liste erlaubt wie bisher.
 * - „nur auf Tippen“ ist hier erlaubt: Wann das Bild startet, entscheidet
 *   die Zentrale (rtc-rules.js).
 */
export function allowedStreams(cameras: LiveModeCamera[], streams: LiveStream[]): StreamAccess {
  const known = cameras.length > 0;
  const hostsWithStream = new Set(
    streams.map((s) => hostKey(s.host)).filter((h) => h && !isLocalHost(h))
  );
  const doorbirds = cameras.filter((c) => c.kind === "DOORBIRD");
  // DoorBirds ohne eigenen Stream nehmen `doorbird` (wie streamFor).
  const doorbirdFallback = doorbirds.filter((c) => !hostsWithStream.has(hostKey(c.host)));
  const anyDoorbirdOff = doorbirds.some((c) => readLiveMode(c.liveMode) === "off");

  const allowed: string[] = [];
  const denied: string[] = [];
  for (const s of streams) {
    if (isMowerStream(s.name)) {
      allowed.push(s.name);
      continue;
    }
    const h = hostKey(s.host);
    const mine = h && !isLocalHost(h) ? cameras.filter((c) => hostKey(c.host) === h) : [];
    // Rueckfall nur, wenn keine Kamera ueber den Host passt: sonst gehoert
    // `doorbird` der DoorBird mit diesem Host allein.
    if (s.name === "doorbird" && mine.length === 0) mine.push(...doorbirdFallback);
    let ok: boolean;
    if (mine.length > 0) ok = !mine.some((c) => readLiveMode(c.liveMode) === "off");
    else if (s.name === "doorbird") ok = !anyDoorbirdOff;
    else ok = !known;
    (ok ? allowed : denied).push(s.name);
  }
  return { allowed, denied };
}

/**
 * Darf die Zentrale den Stream `src` abspielen? Wie allowedStreams; ein
 * Name, den go2rtc nicht (mehr) meldet, ist gesperrt, sobald die
 * Kamera-Liste bekannt ist. Maeher-Streams bleiben erlaubt.
 */
export function streamAllowed(cameras: LiveModeCamera[], streams: LiveStream[], src: string): boolean {
  if (isMowerStream(src)) return true;
  const access = allowedStreams(cameras, streams);
  if (access.allowed.includes(src)) return true;
  if (access.denied.includes(src)) return false;
  return cameras.length === 0;
}
