/**
 * Regeln der Geraete-Liste (smart-devices.ts), ohne Netz und ohne Uhr
 * testbar (smart-devices-rules.test.ts):
 *
 *   - Proben auf Tasmota und Hue: nur Geraete aus dem Scan mit Port 80,
 *     die kein Shelly und keine eingerichtete Kamera, DoorBird oder kein
 *     Switch sind (Adresse oder MAC). Ein Ergebnis gilt je Adresse plus MAC:
 *     ein Treffer 15 Minuten, eine erfolglose Probe 24 Stunden. Ein neues
 *     Geraet unter derselben Adresse (andere MAC) wird sofort geprobt.
 *   - Hoechstens 8 Proben gleichzeitig (mapPool).
 *   - Hersteller-Suche (discovery.meethue.com, api.nuki.io): nach einer
 *     Antwort erst wieder nach 6 Stunden, nach einem Fehler nach 30 Minuten.
 *     Beim Oeffnen der Geraeteliste im Dashboard sofort, hoechstens einmal
 *     je Minute.
 *   - Hue-Kopplung loeschen (Bridge lehnt den Benutzer ab): nur, wenn unter
 *     der Adresse die gekoppelte Bridge selbst antwortet (gleiche Kennung).
 *     Eine andere Bridge unter einer alten Adresse loescht nichts.
 */

export const PROBE_HIT_TTL_MS = 15 * 60_000;
export const PROBE_MISS_TTL_MS = 24 * 3_600_000;
export const PROBE_CONCURRENCY = 8;
export const DISCOVERY_TTL_MS = 6 * 3_600_000;
export const DISCOVERY_RETRY_MS = 30 * 60_000;
export const DISCOVERY_FORCE_MIN_MS = 60_000;

/** Adresse ohne Port, MAC gross geschrieben. */
function hostOnly(h: string): string {
  const s = h.trim();
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  return m ? m[1] : s;
}

/** Schluessel einer Probe: Adresse plus MAC (ohne MAC nur die Adresse). */
export function probeKey(ip: string, mac: string | null | undefined): string {
  return `${hostOnly(ip)}|${(mac ?? "").trim().toUpperCase()}`;
}

/** Gemerktes Ergebnis noch gueltig? Treffer 15 min, erfolglos 24 h. */
export function probeFresh(entry: { at: number; found: boolean } | undefined, now: number): boolean {
  if (!entry || now < entry.at) return false;
  return now - entry.at < (entry.found ? PROBE_HIT_TTL_MS : PROBE_MISS_TTL_MS);
}

export interface ProbeScanDevice {
  ip: string;
  mac: string | null;
  openPorts: number[];
  shelly?: unknown;
}

/** Eingerichtete Geraete, die nie geprobt werden (Adressen und MACs). */
export interface KnownHosts {
  hosts: Iterable<string>;
  macs: Iterable<string | null | undefined>;
}

/**
 * Kandidaten fuer Proben aus dem Scan: kein Shelly, Port 80 offen. `known`
 * sind eingerichtete Kameras, DoorBirds und Switches; sie werden
 * uebersprungen (und gezaehlt).
 */
export function probeCandidates<T extends ProbeScanDevice>(scan: T[], known: KnownHosts): { candidates: T[]; skippedKnown: number } {
  const hosts = new Set([...known.hosts].map(hostOnly));
  const macs = new Set([...known.macs].filter((m): m is string => !!m).map((m) => m.trim().toUpperCase()));
  const candidates: T[] = [];
  let skippedKnown = 0;
  for (const d of scan) {
    if (d.shelly || !d.openPorts.includes(80)) continue;
    if (hosts.has(hostOnly(d.ip)) || (d.mac && macs.has(d.mac.toUpperCase()))) {
      skippedKnown++;
      continue;
    }
    candidates.push(d);
  }
  return { candidates, skippedKnown };
}

/** Gemerkte Ergebnisse, die nicht mehr gelten, entfernen. */
export function pruneProbes<E extends { at: number; found: boolean }>(cache: Map<string, E>, now: number): number {
  let removed = 0;
  for (const [k, e] of cache) {
    if (!probeFresh(e, now)) {
      cache.delete(k);
      removed++;
    }
  }
  return removed;
}

export interface DiscoveryState {
  /** Letzter Versuch (ms), 0 = noch keiner. */
  at: number;
  ok: boolean;
}

/** Hersteller-Suche jetzt faellig? `force`: Geraeteliste im Dashboard geoeffnet. */
export function discoveryDue(state: DiscoveryState, now: number, force = false): boolean {
  if (state.at === 0 || now < state.at) return true;
  const since = now - state.at;
  if (force) return since >= DISCOVERY_FORCE_MIN_MS;
  return since >= (state.ok ? DISCOVERY_TTL_MS : DISCOVERY_RETRY_MS);
}

/** Hue-Kopplung loeschen? Nur wenn unter der Adresse dieselbe Bridge antwortet. */
export function hueUnpairAllowed(pairedId: string, probedId: string | null | undefined): boolean {
  return !!probedId && probedId.toLowerCase() === pairedId.toLowerCase();
}

/** `fn` fuer alle Eintraege, hoechstens `limit` gleichzeitig; Reihenfolge bleibt. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
