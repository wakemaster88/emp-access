/**
 * Abgleich eines Hub-Scans mit den gespeicherten Geraeten (DiscoveredDevice),
 * rein und ohne Datenbank testbar (network-scan-diff.test.ts). Die
 * Schreibung steht in `network-scan-ingest.ts` und folgt genau diesem Plan:
 *
 *   - neu: MAC noch nicht gespeichert, eine Zeile anlegen (createMany);
 *   - geaendert: mindestens ein Feld weicht ab, je Zeile eine Schreibung
 *     mit allen Feldern (die Werte sind je Geraet verschieden);
 *   - unveraendert: alles gleich, nur `lastSeenAt` setzen, alle diese
 *     Zeilen in einer gemeinsamen Schreibung.
 *
 * Die Ping-Zeit (`responseMs`) zaehlt erst ab einer Abweichung von mehr als
 * 20 ms als Aenderung und wird nur dann geschrieben; sonst bleibt der
 * gespeicherte Wert. Alle anderen Felder stehen danach genau so in der
 * Datenbank wie mit einer vollen Schreibung je Geraet.
 */

/** Ab dieser Abweichung (ms, ausschliesslich) wird die Ping-Zeit geschrieben. */
export const RESPONSE_MS_TOLERANCE = 20;

/** Ein Geraet aus dem Scan (bereinigt). */
export interface ScanSeen {
  ip: string | null;
  iface: string | null;
  hostname: string | null;
  vendor: string | null;
  openPorts: number[];
  deviceType: string | null;
  responseMs: number | null;
  reachable: boolean;
}

/** Gespeicherte Zeile, wie der Abgleich sie ohnehin laedt. */
export interface ScanStored {
  macAddress: string;
  ipAddress: string | null;
  iface: string | null;
  hostname: string | null;
  vendor: string | null;
  openPorts: unknown;
  deviceType: string | null;
  responseMs: number | null;
  reachable: boolean;
  absentScans: number;
  hubName: string | null;
  ipHistory: unknown;
  lastSeenAt: Date;
}

/** Bewusst Type-Alias (siehe network-scan-ingest.ts, JSON-Spalte ipHistory). */
export type IpHistoryEntry = { ip: string; seenUntil: string };

export const MAX_IP_HISTORY = 10;

export function pushIpHistory(history: unknown, ip: string | null, seenUntil: Date): IpHistoryEntry[] {
  const entries: IpHistoryEntry[] = Array.isArray(history)
    ? (history as IpHistoryEntry[]).filter((e) => e && typeof e.ip === "string")
    : [];
  if (!ip) return entries;
  return [{ ip, seenUntil: seenUntil.toISOString() }, ...entries.filter((e) => e.ip !== ip)].slice(0, MAX_IP_HISTORY);
}

/** Felder einer vollen Schreibung (wie bisher je Geraet). */
export interface ScanWrite {
  ipAddress: string | null;
  iface: string | null;
  hostname: string | null;
  vendor: string | null;
  openPorts: number[];
  deviceType: string | null;
  responseMs?: number | null;
  reachable: boolean;
  absentScans: number;
  hubName: string | null;
  lastSeenAt: Date;
  ipHistory?: IpHistoryEntry[];
}

export interface ScanDiff {
  fresh: Array<{ mac: string; data: ScanWrite & { responseMs: number | null } }>;
  changed: Array<{ mac: string; data: ScanWrite }>;
  /** MACs, bei denen nur lastSeenAt neu gesetzt wird. */
  unchanged: string[];
}

function samePorts(stored: unknown, seen: number[]): boolean {
  if (!Array.isArray(stored) || stored.length !== seen.length) return false;
  return stored.every((p, i) => p === seen[i]);
}

/** Ping-Zeit gilt als gleich: beide leer oder hoechstens 20 ms auseinander. */
export function sameResponseMs(stored: number | null, seen: number | null): boolean {
  if (stored == null || seen == null) return stored == null && seen == null;
  return Math.abs(stored - seen) <= RESPONSE_MS_TOLERANCE;
}

/**
 * Plan fuer einen Scan: `stored` sind die gespeicherten Zeilen der gesehenen
 * MACs, `seen` die Geraete des Scans je MAC.
 */
export function scanDiff(
  stored: ScanStored[],
  seen: Map<string, ScanSeen>,
  now: Date,
  hubName: string | null,
): ScanDiff {
  const byMac = new Map(stored.map((s) => [s.macAddress, s]));
  const out: ScanDiff = { fresh: [], changed: [], unchanged: [] };
  for (const [mac, info] of seen) {
    const prev = byMac.get(mac);
    const base = {
      ipAddress: info.ip,
      iface: info.iface,
      hostname: info.hostname,
      vendor: info.vendor,
      openPorts: info.openPorts,
      deviceType: info.deviceType,
      reachable: info.reachable,
      absentScans: 0,
      hubName,
      lastSeenAt: now,
    };
    if (!prev) {
      out.fresh.push({ mac, data: { ...base, responseMs: info.responseMs } });
      continue;
    }
    const ipChanged = !!prev.ipAddress && !!info.ip && prev.ipAddress !== info.ip;
    const responseSame = sameResponseMs(prev.responseMs, info.responseMs);
    const same =
      prev.ipAddress === info.ip &&
      prev.iface === info.iface &&
      prev.hostname === info.hostname &&
      prev.vendor === info.vendor &&
      samePorts(prev.openPorts, info.openPorts) &&
      prev.deviceType === info.deviceType &&
      prev.reachable === info.reachable &&
      prev.absentScans === 0 &&
      prev.hubName === hubName &&
      responseSame;
    if (same) {
      out.unchanged.push(mac);
      continue;
    }
    out.changed.push({
      mac,
      data: {
        ...base,
        ...(responseSame ? {} : { responseMs: info.responseMs }),
        ...(ipChanged ? { ipHistory: pushIpHistory(prev.ipHistory, prev.ipAddress, prev.lastSeenAt) } : {}),
      },
    });
  }
  return out;
}

/** Unzugeordnete Eintraege werden geloescht, wenn sie so oft in Folge fehlen. */
export const ABSENT_SCANS_BEFORE_PRUNE = 2;

/**
 * Fehlende Geraete: unzugeordnete, die zum zweiten Mal in Folge fehlen,
 * werden geloescht; alle anderen zaehlen einen Fehlversuch weiter.
 */
export function absentPlan(
  missing: Array<{ id: number; macAddress: string; ipAddress: string | null; absentScans: number }>,
  assignedMacs: Set<string>,
  assignedIps: Set<string>,
): { absent: number[]; toDelete: number[] } {
  const absent: number[] = [];
  const toDelete: number[] = [];
  for (const m of missing) {
    const next = m.absentScans + 1;
    const isAssigned = assignedMacs.has(m.macAddress.toUpperCase()) || (!!m.ipAddress && assignedIps.has(m.ipAddress));
    if (!isAssigned && next >= ABSENT_SCANS_BEFORE_PRUNE) toDelete.push(m.id);
    else absent.push(m.id);
  }
  return { absent, toDelete };
}
