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
