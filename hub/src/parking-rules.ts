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
  count: number;
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
