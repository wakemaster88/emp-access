/**
 * Zutritte je Bereich fuer die Belegungsschaetzung des Hubs
 * (GET /api/hub/occupancy): Eintritte/Austritte der letzten 15 und 60
 * Minuten und des Tages, aus den Scans der Drehkreuze. Nur Logik, damit es
 * testbar bleibt.
 */

export interface RateDevice {
  id: number;
  accessIn: number | null;
  accessOut: number | null;
}

export interface RateArea {
  id: number;
  name: string;
  personLimit: number | null;
}

export interface RateScan {
  deviceId: number | null;
  scanTime: Date;
  result: string;
}

export interface AreaRate {
  id: number;
  name: string;
  personLimit: number | null;
  devices: number;
  /** Erfolgreiche Eintritte (GRANTED an einem Eingangsgeraet). */
  in15: number;
  in60: number;
  inToday: number;
  /** Erfolgreiche Austritte; null = Bereich hat keinen Ausgangs-Zaehlpunkt. */
  out15: number | null;
  out60: number | null;
  outToday: number | null;
  /** Abgelehnte Scans der letzten 15 min (Hinweis auf Stau/Probleme am Drehkreuz). */
  denied15: number;
  /** Geschaetzt im Bereich: heute rein minus raus (nur mit getrenntem Ausgang). */
  inside: number | null;
  lastScanAt: string | null;
}

export function summarizeAreaRates(
  areas: RateArea[],
  devices: RateDevice[],
  scans: RateScan[],
  now: Date,
  dayStart: Date,
): AreaRate[] {
  const t15 = now.getTime() - 15 * 60_000;
  const t60 = now.getTime() - 60 * 60_000;
  const byId = new Map(devices.map((d) => [d.id, d]));
  return areas
    .map((area) => {
      const own = devices.filter((d) => d.accessIn === area.id || d.accessOut === area.id);
      // Geraet mit accessIn == accessOut == Bereich (Durchgang in beide
      // Richtungen) zaehlt als Eingang: Richtung ist im Scan nicht erkennbar.
      const hasSeparateExit = own.some((d) => d.accessOut === area.id && d.accessIn !== area.id);
      const r: AreaRate = {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        devices: own.length,
        in15: 0,
        in60: 0,
        inToday: 0,
        out15: hasSeparateExit ? 0 : null,
        out60: hasSeparateExit ? 0 : null,
        outToday: hasSeparateExit ? 0 : null,
        denied15: 0,
        inside: null,
        lastScanAt: null,
      };
      let last = 0;
      for (const s of scans) {
        const d = s.deviceId != null ? byId.get(s.deviceId) : undefined;
        if (!d || (d.accessIn !== area.id && d.accessOut !== area.id)) continue;
        const t = s.scanTime.getTime();
        if (t < dayStart.getTime() || t > now.getTime()) continue;
        if (t > last) last = t;
        if (s.result !== "GRANTED") {
          if (t >= t15) r.denied15++;
          continue;
        }
        const isIn = d.accessIn === area.id;
        if (isIn) {
          r.inToday++;
          if (t >= t60) r.in60++;
          if (t >= t15) r.in15++;
        } else if (hasSeparateExit) {
          r.outToday!++;
          if (t >= t60) r.out60!++;
          if (t >= t15) r.out15!++;
        }
      }
      if (hasSeparateExit) r.inside = Math.max(0, r.inToday - (r.outToday ?? 0));
      r.lastScanAt = last ? new Date(last).toISOString() : null;
      return r;
    })
    .filter((r) => r.devices > 0);
}

/**
 * Scans des Tages je Geraet und Ergebnis, schon in der Datenbank gezaehlt
 * (`loadDayScanCounts`). Die Zaehlung ab Tagesbeginn ohne Obergrenze braucht
 * die Gesamtsumme der Live-Lage, die Zaehlung bis einschliesslich `now`
 * braucht `summarizeAreaRateCounts` (wie `summarizeAreaRates`).
 */
export interface RateScanCount {
  deviceId: number | null;
  result: string;
  total: number;
  total60: number;
  total15: number;
  upToNow: number;
  upToNow60: number;
  upToNow15: number;
  lastUpToNow: Date | null;
}

/** Dieselbe Zaehlung wie die Datenbank-Abfrage, aus einzelnen Scans (fuer Tests). */
export function countRateScans(scans: RateScan[], now: Date, dayStart: Date): RateScanCount[] {
  const t15 = now.getTime() - 15 * 60_000;
  const t60 = now.getTime() - 60 * 60_000;
  const map = new Map<string, RateScanCount>();
  for (const s of scans) {
    const t = s.scanTime.getTime();
    if (t < dayStart.getTime()) continue;
    const key = `${s.deviceId}:${s.result}`;
    const c = map.get(key) ?? {
      deviceId: s.deviceId,
      result: s.result,
      total: 0,
      total60: 0,
      total15: 0,
      upToNow: 0,
      upToNow60: 0,
      upToNow15: 0,
      lastUpToNow: null,
    };
    c.total++;
    if (t >= t60) c.total60++;
    if (t >= t15) c.total15++;
    if (t <= now.getTime()) {
      c.upToNow++;
      if (t >= t60) c.upToNow60++;
      if (t >= t15) c.upToNow15++;
      if (!c.lastUpToNow || t > c.lastUpToNow.getTime()) c.lastUpToNow = s.scanTime;
    }
    map.set(key, c);
  }
  return [...map.values()];
}

/** Wie `summarizeAreaRates`, aber aus den gezaehlten Scans des Tages. */
export function summarizeAreaRateCounts(
  areas: RateArea[],
  devices: RateDevice[],
  counts: RateScanCount[],
): AreaRate[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  return areas
    .map((area) => {
      const own = devices.filter((d) => d.accessIn === area.id || d.accessOut === area.id);
      const hasSeparateExit = own.some((d) => d.accessOut === area.id && d.accessIn !== area.id);
      const r: AreaRate = {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        devices: own.length,
        in15: 0,
        in60: 0,
        inToday: 0,
        out15: hasSeparateExit ? 0 : null,
        out60: hasSeparateExit ? 0 : null,
        outToday: hasSeparateExit ? 0 : null,
        denied15: 0,
        inside: null,
        lastScanAt: null,
      };
      let last = 0;
      for (const c of counts) {
        const d = c.deviceId != null ? byId.get(c.deviceId) : undefined;
        if (!d || (d.accessIn !== area.id && d.accessOut !== area.id)) continue;
        if (c.upToNow === 0) continue;
        if (c.lastUpToNow && c.lastUpToNow.getTime() > last) last = c.lastUpToNow.getTime();
        if (c.result !== "GRANTED") {
          r.denied15 += c.upToNow15;
          continue;
        }
        if (d.accessIn === area.id) {
          r.inToday += c.upToNow;
          r.in60 += c.upToNow60;
          r.in15 += c.upToNow15;
        } else if (hasSeparateExit) {
          r.outToday! += c.upToNow;
          r.out60! += c.upToNow60;
          r.out15! += c.upToNow15;
        }
      }
      if (hasSeparateExit) r.inside = Math.max(0, r.inToday - (r.outToday ?? 0));
      r.lastScanAt = last ? new Date(last).toISOString() : null;
      return r;
    })
    .filter((r) => r.devices > 0);
}

/** Summen der Live-Lage ueber alle Geraete (auch ohne Geraet), ab Tagesbeginn. */
export function scanTotalsFromCounts(counts: RateScanCount[]) {
  const totals = { in15: 0, in60: 0, inToday: 0, denied15: 0, denied60: 0, deniedToday: 0 };
  for (const c of counts) {
    if (c.result === "GRANTED") {
      totals.inToday += c.total;
      totals.in60 += c.total60;
      totals.in15 += c.total15;
    } else if (c.result === "DENIED") {
      totals.deniedToday += c.total;
      totals.denied60 += c.total60;
      totals.denied15 += c.total15;
    }
  }
  return totals;
}
