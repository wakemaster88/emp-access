import {
  summarizeTurnstileDay,
  type TurnstileDaySummary,
  type TurnstileDayScan,
  type TurnstileWeekCount,
  type TurnstileWeekScan,
} from "@/lib/turnstile-stats";

/**
 * Tagesauswertung des Dashboards je Drehkreuz-Bereich (Strandbad, Seilbahn,
 * Aquapark …). Ersetzt die früheren Mischzahlen über alle Leser („Scans“,
 * „Einlässe“): Eintritte am Strandbad und Fahrten an der Seilbahn sind
 * verschiedene Dinge und werden nicht mehr zusammengezählt.
 *
 * Gezählt wird nur an Geräten, die in den Bereich hinein zählen
 * (`accessIn`). Ausgänge erscheinen in der Leserliste, verfälschen aber nicht
 * die Zahl der Eintritte.
 */

/** Was die Zahl eines Bereichs bedeutet. */
export type AreaMetric = "rides" | "entries" | "passes";

export const AREA_METRIC_LABEL: Record<AreaMetric, string> = {
  rides: "Fahrten",
  entries: "Eintritte",
  passes: "Durchgänge",
};

export type AreaDeviceDirection = "IN" | "OUT" | "BOTH";

export interface AreaDevice {
  id: number;
  name: string;
  accessIn: number | null;
  accessOut: number | null;
  countsAsStart: boolean;
  lastUpdate: Date | null;
}

export interface AreaDayScan extends TurnstileDayScan {
  deviceId: number | null;
}

export interface AreaWeekScan extends TurnstileWeekScan {
  deviceId: number | null;
}

export interface AreaDeviceStat {
  id: number;
  name: string;
  direction: AreaDeviceDirection;
  online: boolean;
  granted: number;
  denied: number;
  total: number;
  lastScanAt: Date | null;
}

export interface AreaDaySummary {
  id: number;
  name: string;
  personLimit: number | null;
  metric: AreaMetric;
  totals: TurnstileDaySummary["totals"];
  average: TurnstileDaySummary["average"];
  hourly: TurnstileDaySummary["hourly"];
  week: TurnstileDaySummary["weekTrend"];
  ticketTypes: TurnstileDaySummary["ticketTypes"];
  denyReasons: TurnstileDaySummary["denyReasons"];
  devices: AreaDeviceStat[];
}

/** Heartbeat der letzten 5 Minuten = online (wie überall im Dashboard). */
export const AREA_DEVICE_ONLINE_MS = 5 * 60_000;

function direction(d: AreaDevice, areaId: number): AreaDeviceDirection {
  if (d.accessIn === areaId && d.accessOut === areaId) return "BOTH";
  return d.accessIn === areaId ? "IN" : "OUT";
}

export function areaMetric(devices: AreaDevice[], areaId: number): AreaMetric {
  const entry = devices.filter((d) => d.accessIn === areaId);
  if (entry.some((d) => d.countsAsStart)) return "rides";
  const separateExit = devices.some((d) => d.accessOut === areaId && d.accessIn !== areaId);
  if (separateExit) return "entries";
  if (entry.length > 0 && entry.every((d) => d.accessOut === areaId)) return "passes";
  return "entries";
}

export function summarizeAreasDay(args: {
  dateStr: string;
  now: Date;
  areas: { id: number; name: string; personLimit: number | null }[];
  devices: AreaDevice[];
  dayScans: AreaDayScan[];
  weekScans: AreaWeekScan[];
  /**
   * Schon gezaehlter Wochenverlauf je Bereich (Eingangsgeraete, Schluessel
   * YYYY-MM-DD); ersetzt dann `weekScans`.
   */
  weekCountsByArea?: Map<number, Map<string, TurnstileWeekCount>>;
  /** Am Tag für den Bereich angelegte Tickets. */
  sold: Map<number, number>;
}): AreaDaySummary[] {
  const onlineSince = args.now.getTime() - AREA_DEVICE_ONLINE_MS;

  return args.areas
    .map((area) => {
      const own = args.devices.filter((d) => d.accessIn === area.id || d.accessOut === area.id);
      return { area, own };
    })
    .filter(({ own }) => own.length > 0)
    // Feste Reihenfolge (meiste Leser zuerst, dann Name): Die Farbe eines
    // Bereichs in den Diagrammen hängt an dieser Position.
    .sort((a, b) => b.own.length - a.own.length || a.area.name.localeCompare(b.area.name, "de"))
    .map(({ area, own }) => {
      const entryIds = new Set(own.filter((d) => d.accessIn === area.id).map((d) => d.id));
      const ownIds = new Set(own.map((d) => d.id));
      const summary = summarizeTurnstileDay({
        dateStr: args.dateStr,
        dayScans: args.dayScans.filter((s) => s.deviceId != null && entryIds.has(s.deviceId)),
        weekScans: args.weekScans.filter((s) => s.deviceId != null && entryIds.has(s.deviceId)),
        weekCounts: args.weekCountsByArea ? (args.weekCountsByArea.get(area.id) ?? new Map()) : undefined,
        soldTickets: args.sold.get(area.id) ?? 0,
        deviceIds: [...entryIds],
      });

      const stats = new Map<number, { granted: number; denied: number; total: number; lastScanAt: Date | null }>();
      for (const s of args.dayScans) {
        if (s.deviceId == null || !ownIds.has(s.deviceId)) continue;
        const cur = stats.get(s.deviceId) ?? { granted: 0, denied: 0, total: 0, lastScanAt: null };
        cur.total++;
        if (s.result === "GRANTED") cur.granted++;
        else if (s.result === "DENIED") cur.denied++;
        if (!cur.lastScanAt || s.scanTime > cur.lastScanAt) cur.lastScanAt = s.scanTime;
        stats.set(s.deviceId, cur);
      }

      const devices: AreaDeviceStat[] = own
        .map((d) => {
          const st = stats.get(d.id) ?? { granted: 0, denied: 0, total: 0, lastScanAt: null };
          return {
            id: d.id,
            name: d.name,
            direction: direction(d, area.id),
            online: !!d.lastUpdate && d.lastUpdate.getTime() >= onlineSince,
            ...st,
          };
        })
        // Eingänge vor Ausgängen, darin die meisten Scans zuerst.
        .sort(
          (a, b) =>
            Number(a.direction === "OUT") - Number(b.direction === "OUT") ||
            b.total - a.total ||
            a.name.localeCompare(b.name, "de"),
        );

      return {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        metric: areaMetric(own, area.id),
        totals: summary.totals,
        average: summary.average,
        hourly: summary.hourly,
        week: summary.weekTrend,
        ticketTypes: summary.ticketTypes,
        denyReasons: summary.denyReasons,
        devices,
      };
    });
}

/** Bereiche ohne einen einzigen Scan in der Woche bleiben aus der Auswertung. */
export function hasWeekActivity(a: Pick<AreaDaySummary, "week" | "totals">): boolean {
  return a.totals.scans > 0 || a.week.some((d) => d.rides > 0 || d.denied > 0);
}
