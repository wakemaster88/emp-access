/**
 * Reine Regeln der Parkmeldung (ohne I/O, testbar): wann der Hub die
 * Park-Kameras in der Cloud sicherstellt, wann er die Belegung meldet und
 * wann er das Bild des Trackers hochlaedt. Ablauf in parking.ts.
 */
import { createHash } from "node:crypto";

/** Takt der Parkmeldung (index.ts). */
export const PARKING_REPORT_TICK_MS = 30_000;
/** Park-Kameras in der Cloud sicherstellen: sonst einmal je Stunde. */
export const ENSURE_EVERY_MS = 3_600_000;
/** Kamera-Liste des Hubs hoechstens so oft als veraltet markieren, wenn die Park-Kamera darin fehlt. */
export const STALE_MARK_GAP_MS = 5 * 60_000;

/** Was an einer Park-Kamera der Kiosk-Konfiguration fuer das Sicherstellen zaehlt. */
export interface ParkingCamKey {
  id: string;
  ip: string;
  port: number;
  channel: number;
  username: string;
  /** Nur ob ein Passwort gesetzt ist; das Passwort selbst geht nicht ein. */
  hasPassword: boolean;
}

/**
 * Kurzer Fingerabdruck der Park-Kameras (id, ip, port, channel, username).
 * Das Passwort geht nicht ein, nur ob eines gesetzt ist: Ohne Passwort
 * uebergeht das Sicherstellen die Kamera, mit einem neu eingetragenen ist
 * es sofort wieder faellig.
 */
export function parkingCamsHash(cams: ParkingCamKey[]): string {
  const rows = cams
    .map((c) => [c.id, c.ip, c.port, c.channel, c.username, c.hasPassword])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
}

/**
 * Park-Kameras in der Cloud sicherstellen? Beim ersten Lauf (`prevHash`
 * null), wenn sich die Park-Kameras der Kiosk-Konfiguration geaendert haben,
 * und sonst einmal je `everyMs` (Sicherheitsnetz, z. B. fuer eine in der
 * Cloud geloeschte Kamera). `prevHash` und `lastAt` stammen vom letzten
 * Lauf, bei dem alle Aufrufe angekommen sind.
 */
export function ensureDue(prevHash: string | null, hash: string, lastAt: number, now: number, everyMs = ENSURE_EVERY_MS): boolean {
  if (prevHash === null || prevHash !== hash) return true;
  return now - lastAt >= everyMs;
}

/**
 * Kennt das Kamera-Modul die Park-Kamera nicht (gerade angelegt, in der
 * Cloud deaktiviert): Kamera-Liste als veraltet markieren, aber hoechstens
 * alle `gapMs`. Sonst laedt der Hub bei einer deaktivierten Kamera alle
 * 30 s die ganze Kamera-Konfiguration neu.
 */
export function staleMarkDue(lastAt: number, now: number, gapMs = STALE_MARK_GAP_MS): boolean {
  return lastAt <= 0 || now - lastAt >= gapMs;
}

/** Eine Parkflaeche, wie sie gemeldet wird (ParkingLotReport in parking.ts). */
export interface ParkingLotLike {
  kioskId: string;
  name: string;
  ip: string;
  mode: string;
  /** null = unbekannt (siehe lotFromCounter). */
  count: number | null;
  lastError: string | null;
  zone: [number, number][] | null;
}

export interface ParkingSnapshotLike {
  trackerOnline: boolean;
  lots: ParkingLotLike[];
}

/** Zuletzt angenommene Meldung: wann und mit welchem Inhalt. */
export interface ParkingReported {
  at: number;
  key: string;
}

/**
 * Inhalt einer Meldung, der eine neue Meldung rechtfertigt: Zaehlung,
 * Fehlertext und Tracker-Zustand, dazu die Flaechen selbst (Name, Adresse,
 * Zone). Zeitstempel und Bildrate des Trackers aendern sich bei jedem Lauf
 * und zaehlen nicht.
 */
export function parkingReportKey(s: ParkingSnapshotLike): string {
  return JSON.stringify([
    s.trackerOnline,
    s.lots.map((l) => [l.kioskId, l.name, l.ip, l.mode, l.count, l.lastError, l.zone]),
  ]);
}

/**
 * Belegung an die Cloud melden? Bei geaenderter Zaehlung, geaendertem
 * Tracker-Zustand oder Fehlertext sofort, sonst als Lebenszeichen nach
 * `idleMs`. Ist `idleMs` nicht laenger als der Takt der Meldung (Standard
 * HUB_PARKING_IDLE_REPORT_S=30), geht jede Meldung hinaus wie bisher.
 */
export function parkingReportDue(prev: ParkingReported | null, next: ParkingSnapshotLike, now: number, idleMs: number): boolean {
  if (idleMs <= PARKING_REPORT_TICK_MS) return true;
  if (!prev) return true;
  if (prev.key !== parkingReportKey(next)) return true;
  return now - prev.at >= idleMs;
}

export interface TrackerFrameGate {
  /** Zaehlung beim letzten hochgeladenen Bild dieser Flaeche; null = noch keins. */
  prevCount: number | null;
  /** Zaehlung jetzt; null = unbekannt. */
  count: number | null;
  /** Letztes hochgeladenes Bild dieser Flaeche (0 = noch keins). */
  lastUploadAt: number;
  now: number;
  /** HUB_PARKING_FRAME_IDLE_S in ms; 0 = bei jedem Lauf (wie bisher). */
  idleMs: number;
}

/**
 * Bild des Trackers hochladen? Mit `idleMs` 0 (Standard) bei jedem Lauf wie
 * bisher. Sonst bei geaenderter Zaehlung sofort und ohne Aenderung nach
 * `idleMs`.
 */
export function trackerFrameDue(g: TrackerFrameGate): boolean {
  if (g.idleMs <= 0) return true;
  if (g.prevCount === null || g.lastUploadAt <= 0) return true;
  if (g.count !== g.prevCount) return true;
  return g.now - g.lastUploadAt >= g.idleMs;
}

const IDLE_LIMIT_S = 3_600;

function secondsEnv(raw: string | undefined, fallbackS: number): number {
  const t = (raw ?? "").trim();
  if (!/^\d+$/.test(t)) return fallbackS * 1000;
  const s = Number(t);
  return s <= IDLE_LIMIT_S ? s * 1000 : fallbackS * 1000;
}

/** HUB_PARKING_IDLE_REPORT_S in ms: 0 bis 3600 s, ungueltig = 30 s (jeder Lauf). */
export function parkingIdleReportMs(raw: string | undefined): number {
  return secondsEnv(raw, 30);
}

/** HUB_PARKING_FRAME_IDLE_S in ms: 0 bis 3600 s, ungueltig = 0 (Bild bei jedem Lauf). */
export function parkingFrameIdleMs(raw: string | undefined): number {
  return secondsEnv(raw, 0);
}

/* ---------------------------------------------------------------------------
 * Zaehlung einer Flaeche aus /counters des Trackers
 * ------------------------------------------------------------------------- */

/** Eintrag einer Flaeche in /counters (aeltere Tracker kennen nicht alle Felder). */
export interface TrackerCounterLike {
  count?: unknown;
  lastUpdate?: unknown;
  lastError?: unknown;
  fps?: unknown;
}

/** ok = Zaehlung aus dem laufenden Videostrom; unbekannt = Tracker fehlt oder meldet einen Fehler. */
export type LotState = "ok" | "unbekannt";

export interface LotCount {
  /** Fahrzeuge in der Flaeche; null = unbekannt. */
  count: number | null;
  state: LotState;
  /** Letzte Aktualisierung laut Tracker (ms), 0 = keine. */
  lastUpdate: number;
  lastError: string | null;
  fps: number;
  /** Bild des Trackers hochladen: nur ohne Fehler, sonst zeigte die Cloud ein altes Bild als neues. */
  upload: boolean;
}

const finite = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Zaehlung einer Flaeche. `live`: ihr Eintrag in /counters, undefined/null
 * wenn der Tracker nicht antwortet oder die Flaeche nicht kennt. `prev`: die
 * zuletzt gemeldete Zaehlung. `atHome`: Die Kamera steht in Grundstellung
 * (sonst zoomt sie gerade und die letzte Zaehlung bleibt stehen).
 *
 * Meldet der Tracker einen Fehler oder fehlt er, ist die Zaehlung unbekannt
 * (null) – nicht die alte Zahl und nicht 0 – und es geht kein Bild hoch.
 */
export function lotFromCounter(
  live: TrackerCounterLike | null | undefined,
  prev: { count: number | null } | null | undefined,
  atHome: boolean,
): LotCount {
  if (!live) return { count: null, state: "unbekannt", lastUpdate: 0, lastError: null, fps: 0, upload: false };
  const lastUpdate = finite(live.lastUpdate);
  const fps = finite(live.fps);
  const lastError = typeof live.lastError === "string" && live.lastError !== "" ? live.lastError : null;
  if (lastError) return { count: null, state: "unbekannt", lastUpdate, lastError, fps, upload: false };
  // Kamera zoomt gerade auf eine Person: letzte Zaehlung halten.
  if (!atHome && prev) {
    return { count: prev.count, state: prev.count === null ? "unbekannt" : "ok", lastUpdate, lastError, fps, upload: true };
  }
  return { count: Number(live.count ?? 0) || 0, state: "ok", lastUpdate, lastError, fps, upload: true };
}

/**
 * So alt darf die letzte Aktualisierung des Trackers sein, damit sein Bild
 * als Bild aus dem laufenden Videostrom gilt (live=1 an die Cloud).
 */
export const FRAME_LIVE_MAX_AGE_MS = 120_000;

/**
 * Bild aus dem laufenden Videostrom? Nur dann setzt die Cloud „zuletzt
 * gesehen“ der Kamera. Der Tracker setzt lastUpdate nur bei einem
 * verarbeiteten Bild.
 */
export function frameLive(lastUpdate: number, now: number, maxAgeMs = FRAME_LIVE_MAX_AGE_MS): boolean {
  return lastUpdate > 0 && Math.abs(now - lastUpdate) <= maxAgeMs;
}

/* ---------------------------------------------------------------------------
 * Tor-Automatik einer Fahrzeug-Flaeche (wie der Tracker sie meldet)
 * ------------------------------------------------------------------------- */

/**
 * Oeffnet die Tor-Automatik der Flaeche, und warum (Text fuer Log und
 * Dashboard). `opens` null: unbekannt – der Tracker meldet es nicht (aelterer
 * Stand, der womoeglich noch nach der alten Einstellung oeffnet), zaehlt die
 * Flaeche nicht oder ist nicht erreichbar.
 */
export interface GateMode {
  opens: boolean | null;
  reason: string;
}

/** Laengster Grund, den der Hub vom Tracker uebernimmt. */
const GATE_REASON_MAX = 200;

/**
 * Tor-Automatik aus der Zaehlung des Trackers (/counters, Feld `gate` je
 * Kamera, `gate_mode` in webcams/tracker/vehicle_gate.py). Der Tracker
 * entscheidet, ob er oeffnet; der Hub zeigt es nur an und schaltet nichts.
 * Fehlt die Angabe, ist es unbekannt – nie „zaehlt nur“.
 */
export function gateMode(counter: { gate?: unknown } | null | undefined, trackerOnline: boolean): GateMode {
  if (!trackerOnline) return { opens: null, reason: "Tracker nicht erreichbar" };
  if (!counter || typeof counter !== "object") return { opens: null, reason: "Tracker zählt diese Fläche nicht" };
  const gate = counter.gate;
  if (!gate || typeof gate !== "object" || typeof (gate as { opens?: unknown }).opens !== "boolean") {
    return { opens: null, reason: "Tracker meldet die Tor-Automatik nicht (älterer Stand)" };
  }
  const g = gate as { opens: boolean; reason?: unknown };
  const reason = typeof g.reason === "string" && g.reason.trim() ? g.reason.trim().slice(0, GATE_REASON_MAX) : "laut Tracker";
  return { opens: g.opens, reason };
}

/** Log-Zeile des Hubs, wenn eine Flaeche neu dazukommt oder ihre Tor-Automatik wechselt. */
export function gateModeLine(name: string, mode: GateMode): string {
  if (mode.opens === null) return `Parkfläche ${name}: Tor-Automatik unbekannt (${mode.reason})`;
  return mode.opens
    ? `Parkfläche ${name}: Tor-Automatik öffnet bei Fahrzeug in der Fläche (${mode.reason})`
    : `Parkfläche ${name}: zählt nur, Tor-Automatik öffnet nicht (${mode.reason})`;
}
