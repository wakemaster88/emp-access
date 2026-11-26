export type ParkingZonePoint = [number, number];

/** ok = Zählung aus dem laufenden Videostrom; unbekannt = Tracker fehlt oder meldet einen Fehler. */
export type ParkingLotState = "ok" | "unbekannt";

export interface ParkingLotReport {
  kioskId: string;
  name: string;
  ip: string;
  mode: "vehicle-zone" | "zone";
  /**
   * Fahrzeuge in der Fläche. Bei unbekannter Zählung 0 (ältere Ansichten
   * rechnen mit einer Zahl); ob sie stimmt, sagt `state`.
   */
  count: number;
  state: ParkingLotState;
  lastUpdate: number;
  lastError: string | null;
  fps: number;
  zone: ParkingZonePoint[] | null;
}

export interface ParkingSnapshot {
  at: string;
  trackerOnline: boolean;
  lots: ParkingLotReport[];
}

export interface ParkingCamMatch {
  id: number;
  name: string;
  kind: string;
  host: string;
  snapshotAt: string | null;
  lastSeenAt: string | null;
  createdAt?: string | null;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function namesMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function newest(a: ParkingCamMatch, b: ParkingCamMatch): ParkingCamMatch {
  const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
  const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
  return tb >= ta ? b : a;
}

export function matchParkingCamera(
  lot: Pick<ParkingLotReport, "name" | "ip">,
  cameras: ParkingCamMatch[],
): ParkingCamMatch | null {
  const ip = lot.ip.trim();
  if (ip) {
    return cameras.find((c) => c.host === ip) ?? null;
  }
  const exact = cameras.filter((c) => norm(c.name) === norm(lot.name));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact.reduce(newest);
  const fuzzy = cameras.filter((c) => namesMatch(c.name, lot.name));
  if (fuzzy.length === 0) return null;
  return fuzzy.reduce(newest);
}

/** Fallback, solange der Hub noch keine Parkzonen gemeldet hat. */
export function fallbackParkingCameras(cameras: ParkingCamMatch[]): ParkingCamMatch[] {
  const hits = cameras.filter((c) => c.kind !== "DOORBIRD" && /halle/i.test(c.name));
  if (hits.length <= 1) return hits;
  return [hits.reduce(newest)];
}

/**
 * Zustand einer gemeldeten Fläche. Ein neuerer Hub schickt `state` und bei
 * unbekannter Zählung `count: null`; bei einem älteren gilt die Zählung als
 * unbekannt, wenn der Tracker offline ist oder einen Fehler meldet.
 */
export function parkingLotState(lot: { state?: unknown; count?: unknown; lastError?: unknown }, trackerOnline: boolean): ParkingLotState {
  if (lot.state === "unbekannt" || lot.count === null) return "unbekannt";
  if (!trackerOnline) return "unbekannt";
  if (typeof lot.lastError === "string" && lot.lastError !== "") return "unbekannt";
  return "ok";
}

/**
 * „Zuletzt gesehen“ der Kamera mit diesem Bild setzen? Bilder der Parkfläche
 * (`source=parking`) nur, wenn der Hub sie als Bild aus dem laufenden
 * Videostrom kennzeichnet (`live=1`); alle anderen Bilder wie bisher immer.
 */
export function snapshotMarksSeen(params: URLSearchParams): boolean {
  if (params.get("source") !== "parking") return true;
  return params.get("live") === "1";
}

export function parseParkingSnapshot(raw: unknown): ParkingSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const status = raw as { parking?: unknown };
  const parking = status.parking;
  if (!parking || typeof parking !== "object") return null;
  const p = parking as Record<string, unknown>;
  const lots = Array.isArray(p.lots) ? p.lots : [];
  const trackerOnline = p.trackerOnline === true;
  return {
    at: typeof p.at === "string" ? p.at : new Date().toISOString(),
    trackerOnline,
    lots: lots
      .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
      .map((l) => ({
        kioskId: String(l.kioskId ?? ""),
        name: String(l.name ?? ""),
        ip: String(l.ip ?? ""),
        mode: (l.mode === "zone" ? "zone" : "vehicle-zone") as ParkingLotReport["mode"],
        count: Number(l.count ?? 0) || 0,
        state: parkingLotState(l, trackerOnline),
        lastUpdate: Number(l.lastUpdate ?? 0) || 0,
        lastError: typeof l.lastError === "string" ? l.lastError : null,
        fps: Number(l.fps ?? 0) || 0,
        zone: Array.isArray(l.zone)
          ? (l.zone.filter(
              (pt): pt is ParkingZonePoint =>
                Array.isArray(pt) && pt.length === 2 && typeof pt[0] === "number" && typeof pt[1] === "number",
            ) as ParkingZonePoint[])
          : null,
      }))
      .filter((l) => l.kioskId || l.name),
  };
}
